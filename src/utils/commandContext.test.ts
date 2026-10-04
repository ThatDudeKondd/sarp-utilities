import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Message } from "discord.js";
import { CommandContext } from "./commandContext.js";
import type { CommandOption } from "../types/UnifiedCommand.js";

/** A prefix Message that passes `instanceof Message`, with stubbed collections. */
function fakeMessage(extra: Record<string, unknown> = {}) {
  const sent: any[] = [];
  const props: Record<string, unknown> = {
    author: { id: "author" },
    member: null,
    guild: null,
    mentions: { users: new Map(), channels: new Map(), roles: new Map() },
    client: { users: { cache: new Map() } },
    channel: {
      isSendable: () => true,
      send: async (payload: any) => {
        sent.push(payload);
        return { edit: async (p: any) => sent.push({ edited: p }) };
      },
    },
    ...extra,
  };
  // Message.prototype defines getters (e.g. `member`), so plain assignment fails.
  const msg = Object.create(
    Message.prototype,
    Object.fromEntries(Object.entries(props).map(([k, value]) => [k, { value, writable: true }])),
  );
  return { msg, sent };
}

const opt = (name: string, type: CommandOption["type"]): CommandOption => ({ name, description: name, type });

describe("CommandContext prefix argument parsing", () => {
  test("the trailing string option swallows the rest of the args", () => {
    const { msg } = fakeMessage();
    const ctx = new CommandContext(msg, [opt("count", "integer"), opt("reason", "string")], ["3", "being", "rude"]);
    assert.equal(ctx.getInteger("count"), 3);
    assert.equal(ctx.getString("reason"), "being rude");
  });

  test("a non-trailing string option takes one token", () => {
    const { msg } = fakeMessage();
    const ctx = new CommandContext(msg, [opt("a", "string"), opt("b", "string")], ["x", "y", "z"]);
    assert.equal(ctx.getString("a"), "x");
    assert.equal(ctx.getString("b"), "y z");
  });

  test("numbers, invalid numbers and booleans", () => {
    const { msg } = fakeMessage();
    const ctx = new CommandContext(
      msg,
      [opt("n", "number"), opt("i", "integer"), opt("yes", "boolean"), opt("no", "boolean"), opt("last", "string")],
      ["1.5", "abc", "YES", "nah", "end"],
    );
    assert.equal(ctx.getNumber("n"), 1.5);
    assert.equal(ctx.getInteger("i"), null);
    assert.equal(ctx.getBoolean("yes"), true);
    assert.equal(ctx.getBoolean("no"), false);
  });

  test("missing args resolve to null", () => {
    const { msg } = fakeMessage();
    const ctx = new CommandContext(msg, [opt("a", "string"), opt("b", "integer")], []);
    assert.equal(ctx.getString("a"), null);
    assert.equal(ctx.getInteger("b"), null);
  });

  test("users, channels and roles resolve from mentions or by raw ID", () => {
    const user = { id: "111" };
    const channel = { id: "222" };
    const role = { id: "333" };
    const { msg } = fakeMessage({
      mentions: { users: new Map([["111", user]]), channels: new Map(), roles: new Map() },
      guild: { channels: { cache: new Map([["222", channel]]) }, roles: { cache: new Map([["333", role]]) } },
    });
    const ctx = new CommandContext(
      msg,
      [opt("u", "user"), opt("c", "channel"), opt("r", "role")],
      ["<@!111>", "<#222>", "333"],
    );
    assert.equal(ctx.getUser("u"), user);
    assert.equal(ctx.getChannel("c"), channel);
    assert.equal(ctx.getRole("r"), role);
  });

  test("unknown mentions resolve to null instead of throwing", () => {
    const { msg } = fakeMessage({ guild: { channels: { cache: new Map() }, roles: { cache: new Map() } } });
    const ctx = new CommandContext(msg, [opt("u", "user"), opt("r", "role")], ["<@999>", "<@&999>"]);
    assert.equal(ctx.getUser("u"), null);
    assert.equal(ctx.getRole("r"), null);
  });

  test("subcommand is the first raw arg for prefix commands", () => {
    const { msg } = fakeMessage();
    assert.equal(new CommandContext(msg, [], ["link", "x"]).subcommand, "link");
    assert.equal(new CommandContext(msg, [], []).subcommand, null);
  });
});

describe("CommandContext replies", () => {
  test("prefix replies become embeds and drop interaction-only flags", async () => {
    const { msg, sent } = fakeMessage();
    const ctx = new CommandContext(msg);
    await ctx.reply({ content: "hi", flags: 64 });
    assert.equal(sent[0].flags, undefined);
    assert.equal(sent[0].content, "");
    assert.equal(sent[0].embeds[0].data.description, "hi");
  });

  test("a plain string reply is converted too", async () => {
    const { msg, sent } = fakeMessage();
    await new CommandContext(msg).reply("❌ broken");
    assert.equal(sent[0].embeds[0].data.description, "❌ broken");
  });

  test("editReply edits the last prefix reply instead of sending a new one", async () => {
    const { msg, sent } = fakeMessage();
    const ctx = new CommandContext(msg);
    await ctx.reply("first");
    await ctx.editReply({ content: "second" });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].edited.embeds[0].data.description, "second");
  });

  test("editReply without a previous reply sends one", async () => {
    const { msg, sent } = fakeMessage();
    await new CommandContext(msg).editReply({ content: "x" });
    assert.equal(sent.length, 1);
  });

  test("unsendable channels throw", async () => {
    const { msg } = fakeMessage({ channel: { isSendable: () => false } });
    await assert.rejects(new CommandContext(msg).reply("x"), /Cannot send messages/);
  });

  test("slash replies use reply first, then followUp", async () => {
    const calls: string[] = [];
    const interaction: any = {
      replied: false,
      deferred: false,
      user: { id: "u" },
      reply: async () => {
        calls.push("reply");
        interaction.replied = true;
      },
      followUp: async () => void calls.push("followUp"),
    };
    const ctx = new CommandContext(interaction);
    await ctx.reply("a");
    await ctx.reply("b");
    assert.deepEqual(calls, ["reply", "followUp"]);
    assert.equal(ctx.isSlash, true);
  });

  test("slash editReply before replying throws", async () => {
    const interaction: any = { replied: false, deferred: false };
    await assert.rejects(new CommandContext(interaction).editReply({ content: "x" }), /before replying/);
  });

  test("defer only defers slash commands that haven't replied", async () => {
    let deferred = 0;
    const interaction: any = { replied: false, deferred: false, deferReply: async () => void deferred++ };
    await new CommandContext(interaction).defer();
    assert.equal(deferred, 1);
    const { msg } = fakeMessage();
    await new CommandContext(msg).defer(); // no-op, must not throw
  });
});
