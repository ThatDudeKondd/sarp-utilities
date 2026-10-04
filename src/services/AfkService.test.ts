import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { handleAfkMessage, setAfk } from "./AfkService.js";
import { fakeClient, fakeGuild, member } from "../test/fakes.js";

/** A guild message from `authorId` mentioning `mentioned`, capturing replies. */
function fakeMessage(client: any, authorId: string, mentioned: { id: string }[] = [], bot = false) {
  const replies: any[] = [];
  return {
    replies,
    message: {
      client,
      author: { id: authorId, bot },
      channel: { isSendable: () => true },
      mentions: { users: new Map(mentioned.map((u) => [u.id, u])) },
      reply: async (payload: any) => void replies.push(payload),
    } as any,
  };
}

// AFK state is module-global, so each test uses its own user IDs.

describe("setAfk", () => {
  test("prefixes the current display name with [AFK]", async () => {
    const g = fakeGuild("g", [member("a1", [], { displayName: "Kon" })]);
    await setAfk("a1", "lunch", await g.guild.members.fetch("a1"));
    assert.equal(g.byId.get("a1")!.nickname, "[AFK] Kon");
  });

  test("uses the existing nickname and truncates to Discord's 32 chars", async () => {
    const g = fakeGuild("g", [member("a2", [], { nickname: "x".repeat(40) })]);
    await setAfk("a2", "brb", await g.guild.members.fetch("a2"));
    const nick = g.byId.get("a2")!.nickname!;
    assert.equal(nick.length, 32);
    assert.ok(nick.startsWith("[AFK] "));
  });

  test("doesn't double-prefix", async () => {
    const g = fakeGuild("g", [member("a3", [], { nickname: "[AFK] Kon" })]);
    await setAfk("a3", "brb", await g.guild.members.fetch("a3"));
    assert.equal(g.byId.get("a3")!.nickname, "[AFK] Kon");
  });

  test("still sets AFK when the nickname can't be changed (owner / higher role)", async () => {
    const g = fakeGuild("g", [member("a4")]);
    const m = await g.guild.members.fetch("a4");
    m.setNickname = async () => {
      throw new Error("Missing Permissions");
    };
    await setAfk("a4", "brb", m);
    const { message, replies } = fakeMessage(fakeClient(g.guild), "x", [{ id: "a4" }]);
    await handleAfkMessage(message);
    assert.equal(replies.length, 1);
  });

  test("works outside a guild (no member)", async () => {
    await setAfk("a5", "dm", null);
    const { message, replies } = fakeMessage(fakeClient(), "a5");
    await handleAfkMessage(message);
    assert.match(replies[0].embeds[0].data.description, /Welcome back/);
  });
});

describe("handleAfkMessage", () => {
  test("coming back restores the old nickname and sends a welcome embed", async () => {
    const g = fakeGuild("g", [member("b1", [], { nickname: "Kondd" })]);
    await setAfk("b1", "lunch", await g.guild.members.fetch("b1"));
    const { message, replies } = fakeMessage(fakeClient(g.guild), "b1");
    await handleAfkMessage(message);
    assert.equal(g.byId.get("b1")!.nickname, "Kondd");
    assert.match(replies[0].embeds[0].data.description, /Welcome back/);
  });

  test("restores 'no nickname' as null", async () => {
    const g = fakeGuild("g", [member("b2", [], { displayName: "Kon" })]);
    await setAfk("b2", "lunch", await g.guild.members.fetch("b2"));
    await handleAfkMessage(fakeMessage(fakeClient(g.guild), "b2").message);
    assert.equal(g.byId.get("b2")!.nickname, null);
  });

  test("leaves a nickname they changed while AFK alone", async () => {
    const g = fakeGuild("g", [member("b3", [], { nickname: "Old" })]);
    await setAfk("b3", "lunch", await g.guild.members.fetch("b3"));
    g.byId.get("b3")!.nickname = "Brand New";
    await handleAfkMessage(fakeMessage(fakeClient(g.guild), "b3").message);
    assert.equal(g.byId.get("b3")!.nickname, "Brand New");
  });

  test("only clears AFK once", async () => {
    await setAfk("b4", "x", null);
    await handleAfkMessage(fakeMessage(fakeClient(), "b4").message);
    const second = fakeMessage(fakeClient(), "b4");
    await handleAfkMessage(second.message);
    assert.equal(second.replies.length, 0);
  });

  test("pinging an AFK user replies with their reason, without pinging anyone", async () => {
    await setAfk("c1", "at the gym", null);
    const { message, replies } = fakeMessage(fakeClient(), "pinger", [{ id: "c1" }]);
    await handleAfkMessage(message);
    const desc = replies[0].embeds[0].data.description;
    assert.match(desc, /<@c1> is currently AFK for: \*\*at the gym\*\*/);
    assert.deepEqual(replies[0].allowedMentions, { parse: [] });
  });

  test("several AFK users share one embed", async () => {
    await setAfk("c2", "one", null);
    await setAfk("c3", "two", null);
    const { message, replies } = fakeMessage(fakeClient(), "pinger2", [{ id: "c2" }, { id: "c3" }]);
    await handleAfkMessage(message);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].embeds[0].data.description.split("\n").length, 2);
  });

  test("mentioning non-AFK users sends nothing", async () => {
    const { message, replies } = fakeMessage(fakeClient(), "pinger3", [{ id: "not-afk" }]);
    await handleAfkMessage(message);
    assert.equal(replies.length, 0);
  });

  test("ignores bots", async () => {
    await setAfk("c4", "x", null);
    const { message, replies } = fakeMessage(fakeClient(), "bot", [{ id: "c4" }], true);
    await handleAfkMessage(message);
    assert.equal(replies.length, 0);
  });
});
