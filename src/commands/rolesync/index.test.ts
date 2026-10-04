import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import rolesync from "./index.js";
import { fakeClient, fakeGuild, member, stubPrisma } from "../../test/fakes.js";

const sub = (name: string) => rolesync.subcommands!.find((s) => s.name === name)!;

/** A guild plus Role objects shaped like discord.js's (members, editable, guild). */
function guildWithRoles(id: string, members: ReturnType<typeof member>[], roleIds: string[], editable = true) {
  const g = fakeGuild(id, members);
  const roles = new Map(
    roleIds.map((rid) => [
      rid,
      {
        id: rid,
        name: `role-${rid}`,
        editable,
        guild: g.guild,
        get members() {
          return new Map([...g.byId.values()].filter((m) => m.roles.has(rid)).map((m) => [m.id, m]));
        },
        toString: () => `<@&${rid}>`,
      },
    ]),
  );
  g.guild.roles = { cache: roles };
  return { ...g, roles };
}

function ctxFor(opts: {
  here: ReturnType<typeof guildWithRoles>;
  others: any[];
  role?: string;
  strings: Record<string, string>;
  userId?: string;
}) {
  const replies: any[] = [];
  const client = fakeClient(opts.here.guild, ...opts.others);
  const ctx: any = {
    client,
    guild: opts.here.guild,
    user: { id: opts.userId ?? "admin" },
    defer: async () => {},
    getRole: () => (opts.role ? opts.here.roles.get(opts.role) : null),
    getString: (n: string) => opts.strings[n] ?? null,
    editReply: async (p: any) => void replies.push(p),
    reply: async (p: any) => void replies.push(p),
  };
  return { ctx, replies };
}

/** In-memory RoleLink table supporting upsert / deleteMany / findMany as the command uses them. */
function linkTable() {
  const rows: any[] = [];
  const key = (l: any) => `${l.sourceGuildId}/${l.sourceRoleId}>${l.targetGuildId}/${l.targetRoleId}`;
  const restore = stubPrisma("roleLink", {
    upsert: async ({ create }: any) => {
      if (!rows.some((r) => key(r) === key(create))) rows.push(create);
    },
    deleteMany: async ({ where }: any) => {
      const before = rows.length;
      for (const cond of where.OR) {
        const i = rows.findIndex((r) => key(r) === key(cond));
        if (i >= 0) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    },
    findMany: async ({ where }: any) =>
      rows.filter((r) =>
        where.OR
          ? where.OR.some((c: any) => Object.entries(c).every(([k, v]) => r[k] === v))
          : Object.entries(where).every(([k, v]) => r[k] === v),
      ),
  });
  return { rows, restore };
}

let restore = () => {};
afterEach(() => restore());

function setup(otherAdmin = true, editable = true) {
  const t = linkTable();
  restore = t.restore;
  const here = guildWithRoles("here", [member("admin", ["hr"]), member("h1", ["hr"])], ["hr"], editable);
  const there = guildWithRoles("there", [member("admin", [], { isAdmin: otherAdmin }), member("t1", ["tr"])], ["tr"], editable);
  const strings = { other_server_id: "there", other_server_role_id: "tr" };
  return { t, here, there, strings };
}

const descriptionOf = (reply: any) => reply.embeds[0].data.description as string;

describe("/rolesync link", () => {
  test("two-way by default: writes both rows and backfills both ways", async () => {
    const { t, here, there, strings } = setup();
    const { ctx, replies } = ctxFor({ here, others: [there.guild], role: "hr", strings });
    await sub("link").execute(ctx);
    assert.equal(t.rows.length, 2);
    assert.ok(here.byId.get("t1") === undefined); // t1 isn't in "here"; nothing to grant there
    assert.ok(there.byId.get("admin")!.roles.has("tr")); // admin held hr → gets tr
    assert.match(descriptionOf(replies[0]), /both ways/);
  });

  test("to_here writes only other→here and doesn't need admin in the other server", async () => {
    const { t, here, there, strings } = setup(false);
    const { ctx, replies } = ctxFor({ here, others: [there.guild], role: "hr", strings: { ...strings, direction: "to_here" } });
    await sub("link").execute(ctx);
    assert.deepEqual(t.rows, [{ sourceGuildId: "there", sourceRoleId: "tr", targetGuildId: "here", targetRoleId: "hr" }]);
    assert.equal(there.byId.get("admin")!.roles.has("tr"), false); // never grants in the other server
    assert.match(descriptionOf(replies[0]), /one-way/);
  });

  test("to_other writes only here→other and requires admin there", async () => {
    const { t, here, there, strings } = setup(false);
    const { ctx, replies } = ctxFor({ here, others: [there.guild], role: "hr", strings: { ...strings, direction: "to_other" } });
    await sub("link").execute(ctx);
    assert.equal(t.rows.length, 0);
    assert.match(descriptionOf(replies[0]), /administrator there/);
  });

  test("two-way also requires admin in the other server", async () => {
    const { t, here, there, strings } = setup(false);
    const { ctx } = ctxFor({ here, others: [there.guild], role: "hr", strings });
    await sub("link").execute(ctx);
    assert.equal(t.rows.length, 0);
  });

  test("rejects an invalid direction", async () => {
    const { t, here, there, strings } = setup();
    const { ctx, replies } = ctxFor({ here, others: [there.guild], role: "hr", strings: { ...strings, direction: "sideways" } });
    await sub("link").execute(ctx);
    assert.equal(t.rows.length, 0);
    assert.match(descriptionOf(replies[0]), /Direction must be one of/);
  });

  test("rejects linking to the same server or one the bot isn't in", async () => {
    const { here, there } = setup();
    for (const other_server_id of ["here", "nowhere"]) {
      const { ctx, replies } = ctxFor({ here, others: [there.guild], role: "hr", strings: { other_server_id, other_server_role_id: "tr" } });
      await sub("link").execute(ctx);
      assert.match(descriptionOf(replies[0]), /isn't in that server/);
    }
  });

  test("rejects an unknown role in the other server", async () => {
    const { here, there } = setup();
    const { ctx, replies } = ctxFor({ here, others: [there.guild], role: "hr", strings: { other_server_id: "there", other_server_role_id: "nope" } });
    await sub("link").execute(ctx);
    assert.match(descriptionOf(replies[0]), /doesn't exist/);
  });

  test("rejects roles the bot can't manage", async () => {
    const { t, here, there, strings } = setup(true, false);
    const { ctx, replies } = ctxFor({ here, others: [there.guild], role: "hr", strings });
    await sub("link").execute(ctx);
    assert.equal(t.rows.length, 0);
    assert.match(descriptionOf(replies[0]), /can't manage/);
  });

  test("requires membership in the other server", async () => {
    const { here, there, strings } = setup();
    const { ctx, replies } = ctxFor({ here, others: [there.guild], role: "hr", strings: { ...strings, direction: "to_here" }, userId: "stranger" });
    await sub("link").execute(ctx);
    assert.match(descriptionOf(replies[0]), /must be a member/);
  });

  test("linking twice doesn't duplicate rows", async () => {
    const { t, here, there, strings } = setup();
    for (let i = 0; i < 2; i++) {
      const { ctx } = ctxFor({ here, others: [there.guild], role: "hr", strings });
      await sub("link").execute(ctx);
    }
    assert.equal(t.rows.length, 2);
  });
});

describe("/rolesync unlink and list", () => {
  test("unlink removes both directions", async () => {
    const { t, here, there, strings } = setup();
    await sub("link").execute(ctxFor({ here, others: [there.guild], role: "hr", strings }).ctx);
    const { ctx, replies } = ctxFor({ here, others: [there.guild], role: "hr", strings });
    await sub("unlink").execute(ctx);
    assert.equal(t.rows.length, 0);
    assert.match(replies[0].embeds[0].data.title, /Link removed/);
  });

  test("unlink of a missing link says so", async () => {
    const { here, there, strings } = setup();
    const { ctx, replies } = ctxFor({ here, others: [there.guild], role: "hr", strings });
    await sub("unlink").execute(ctx);
    assert.match(replies[0].embeds[0].data.title, /No such link/);
  });

  test("list shows two-way pairs once with ↔ and one-way links with →", async () => {
    const { here, there, strings } = setup();
    await sub("link").execute(ctxFor({ here, others: [there.guild], role: "hr", strings }).ctx);
    let { ctx, replies } = ctxFor({ here, others: [there.guild], strings: {} });
    await sub("list").execute(ctx);
    let lines = descriptionOf(replies[0]).split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /↔/);

    await sub("unlink").execute(ctxFor({ here, others: [there.guild], role: "hr", strings }).ctx);
    await sub("link").execute(ctxFor({ here, others: [there.guild], role: "hr", strings: { ...strings, direction: "to_here" } }).ctx);
    ({ ctx, replies } = ctxFor({ here, others: [there.guild], strings: {} }));
    await sub("list").execute(ctx);
    lines = descriptionOf(replies[0]).split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /→/);
  });

  test("list with no links", async () => {
    const { here, there } = setup();
    const { ctx, replies } = ctxFor({ here, others: [there.guild], strings: {} });
    await sub("list").execute(ctx);
    assert.equal(descriptionOf(replies[0]), "No links yet.");
  });
});
