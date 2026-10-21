import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import infract from "./infract.js";
import { spy, stubPrisma } from "../../test/fakes.js";

const userFind = spy(async () => null);
const infractionCreate = spy(async () => ({ caseNumber: 1 }));
let restores: Array<() => void> = [];

beforeEach(() => {
  userFind.calls.length = 0;
  infractionCreate.calls.length = 0;
  restores = [
    stubPrisma("user", { findUnique: userFind }),
    stubPrisma("infraction", { create: infractionCreate }),
    stubPrisma("guildConfig", { findUnique: async () => null }),
  ];
});
afterEach(() => restores.forEach((r) => r()));

function ctx(user: unknown, punishment: string | null, reason: string | null) {
  const replies: any[] = [];
  const c: any = {
    defer: async () => {},
    message: { delete: async () => {} },
    getUser: () => user,
    getString: (name: string) => (name === "punishment" ? punishment : reason),
    guild: { id: "g" },
    member: { roles: { cache: { some: () => true } } },
    editReply: async (p: any) => void replies.push(p),
  };
  return { c, replies };
}

test("unresolved user replies with a usage error and never touches Prisma", async () => {
  const { c, replies } = ctx(null, "warn", "spam");
  await infract.execute!(c);
  assert.equal(userFind.calls.length, 0);
  assert.equal(infractionCreate.calls.length, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0].embeds[0].data.description ?? replies[0].embeds[0].data.title, /Usage|Missing/);
});

test("missing punishment/reason also short-circuits before Prisma", async () => {
  const { c, replies } = ctx({ id: "u1" }, null, null);
  await infract.execute!(c);
  assert.equal(infractionCreate.calls.length, 0);
  assert.equal(replies.length, 1);
});
