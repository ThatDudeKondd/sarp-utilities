import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { grantToHolders, onMemberJoined, onMemberLeft, onRoleChanged } from "./RoleSyncService.js";
import { fakeClient, fakeGuild, member, stubPrisma } from "../test/fakes.js";

interface Link {
  sourceGuildId: string;
  sourceRoleId: string;
  targetGuildId: string;
  targetRoleId: string;
}

/** An in-memory RoleLink table answering the `where` shapes the service uses. */
function linkTable(links: Link[]) {
  return stubPrisma("roleLink", {
    findMany: async ({ where }: { where: Partial<Link> }) =>
      links.filter((l) => Object.entries(where).every(([k, v]) => (l as any)[k] === v)),
  });
}

const twoWay = (a: [string, string], b: [string, string]): Link[] => [
  { sourceGuildId: a[0], sourceRoleId: a[1], targetGuildId: b[0], targetRoleId: b[1] },
  { sourceGuildId: b[0], sourceRoleId: b[1], targetGuildId: a[0], targetRoleId: a[1] },
];

let restore = () => {};
afterEach(() => restore());

describe("onRoleChanged", () => {
  test("gaining a linked role grants the partner role", async () => {
    restore = linkTable(twoWay(["main", "mainRole"], ["dept", "deptRole"]));
    const main = fakeGuild("main", [member("u", ["mainRole"])]);
    const dept = fakeGuild("dept", [member("u")]);
    await onRoleChanged(fakeClient(main.guild, dept.guild), "u", "main", "mainRole", true);
    assert.ok(dept.byId.get("u")!.roles.has("deptRole"));
  });

  test("losing a linked role removes the partner role", async () => {
    restore = linkTable(twoWay(["main", "mainRole"], ["dept", "deptRole"]));
    const dept = fakeGuild("dept", [member("u", ["deptRole"])]);
    await onRoleChanged(fakeClient(fakeGuild("main").guild, dept.guild), "u", "main", "mainRole", false);
    assert.equal(dept.byId.get("u")!.roles.has("deptRole"), false);
  });

  test("one-way links only propagate from source to target", async () => {
    restore = linkTable([{ sourceGuildId: "dept", sourceRoleId: "deptRole", targetGuildId: "main", targetRoleId: "mainRole" }]);
    const main = fakeGuild("main", [member("u", ["mainRole"])]);
    const dept = fakeGuild("dept", [member("u")]);
    const client = fakeClient(main.guild, dept.guild);
    // Removing the TARGET by hand must not touch the source.
    await onRoleChanged(client, "u", "main", "mainRole", false);
    assert.equal(dept.byId.get("u")!.roles.has("deptRole"), false);
    // The source still drives the target.
    await onRoleChanged(client, "u", "dept", "deptRole", true);
    assert.ok(main.byId.get("u")!.roles.has("mainRole"));
  });

  test("users missing from the target guild are skipped without throwing", async () => {
    restore = linkTable(twoWay(["main", "mainRole"], ["dept", "deptRole"]));
    await onRoleChanged(fakeClient(fakeGuild("main").guild, fakeGuild("dept").guild), "ghost", "main", "mainRole", true);
  });

  test("a failing role change on one link doesn't stop the others", async () => {
    restore = linkTable([
      { sourceGuildId: "main", sourceRoleId: "r", targetGuildId: "broken", targetRoleId: "x" },
      { sourceGuildId: "main", sourceRoleId: "r", targetGuildId: "dept", targetRoleId: "deptRole" },
    ]);
    const broken = fakeGuild("broken", [member("u")]);
    broken.guild.members.fetch = async () => ({
      roles: { cache: { has: () => false }, add: async () => { throw new Error("Missing Permissions"); } },
    });
    const dept = fakeGuild("dept", [member("u")]);
    await onRoleChanged(fakeClient(broken.guild, dept.guild), "u", "main", "r", true);
    assert.ok(dept.byId.get("u")!.roles.has("deptRole"));
  });

  test("no-ops when the role is already in the right state", async () => {
    restore = linkTable(twoWay(["main", "mainRole"], ["dept", "deptRole"]));
    let adds = 0;
    const dept = fakeGuild("dept", [member("u", ["deptRole"])]);
    const realFetch = dept.guild.members.fetch;
    dept.guild.members.fetch = async (id: string) => {
      const m = await realFetch(id);
      return { ...m, roles: { ...m.roles, add: async () => void adds++ } };
    };
    await onRoleChanged(fakeClient(fakeGuild("main").guild, dept.guild), "u", "main", "mainRole", true);
    assert.equal(adds, 0);
  });
});

describe("onMemberJoined", () => {
  test("grants roles here for source roles the member already holds elsewhere", async () => {
    restore = linkTable(twoWay(["main", "mainRole"], ["dept", "deptRole"]));
    const main = fakeGuild("main", [member("u", ["mainRole"])]);
    const dept = fakeGuild("dept", [member("u")]);
    await onMemberJoined(fakeClient(main.guild, dept.guild), "u", "dept");
    assert.ok(dept.byId.get("u")!.roles.has("deptRole"));
  });

  test("grants nothing when they don't hold the source role", async () => {
    restore = linkTable(twoWay(["main", "mainRole"], ["dept", "deptRole"]));
    const dept = fakeGuild("dept", [member("u")]);
    await onMemberJoined(fakeClient(fakeGuild("main", [member("u")]).guild, dept.guild), "u", "dept");
    assert.equal(dept.byId.get("u")!.roles.size, 0);
  });
});

describe("onMemberLeft", () => {
  test("removes every role linked from the guild they left", async () => {
    restore = linkTable(twoWay(["main", "mainRole"], ["dept", "deptRole"]));
    const dept = fakeGuild("dept", [member("u", ["deptRole", "other"])]);
    await onMemberLeft(fakeClient(fakeGuild("main").guild, dept.guild), "u", "main");
    assert.deepEqual([...dept.byId.get("u")!.roles], ["other"]);
  });
});

describe("grantToHolders", () => {
  test("adds the target role to every listed member and never removes", async () => {
    const dept = fakeGuild("dept", [member("a"), member("b", ["deptRole"]), member("c")]);
    await grantToHolders(fakeClient(dept.guild), ["a", "b"], "dept", "deptRole");
    assert.ok(dept.byId.get("a")!.roles.has("deptRole"));
    assert.ok(dept.byId.get("b")!.roles.has("deptRole"));
    assert.equal(dept.byId.get("c")!.roles.has("deptRole"), false);
  });
});
