import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { Message } from "discord.js";
import { CommandHandler } from "./CommandHandler.js";
import { stubPrisma } from "../test/fakes.js";
import type { UnifiedCommand } from "../types/UnifiedCommand.js";

let restore = () => {};
beforeEach(() => {
  // getConfig/getPrefix: every guild uses "-" as its prefix.
  restore = stubPrisma("guildConfig", { findUnique: async () => ({ guildId: "g", prefix: "-", logsChannel: "" }) });
});
afterEach(() => restore());

let userSeq = 0;
/** A prefix message from a fresh user (fresh, so cooldowns never carry over between tests). */
function message(content: string, extra: Record<string, unknown> = {}) {
  const replies: any[] = [];
  const sent: any[] = [];
  const props: Record<string, unknown> = {
    content,
    author: { id: `user${++userSeq}`, bot: false, tag: "user#0" },
    guild: { id: "g" },
    member: { permissions: { has: () => true } },
    mentions: { users: new Map(), channels: new Map(), roles: new Map() },
    client: { users: { cache: new Map() } },
    channel: { isSendable: () => true, send: async (p: any) => void sent.push(p) },
    reply: async (p: any) => void replies.push(p),
    ...extra,
  };
  const msg = Object.create(
    Message.prototype,
    Object.fromEntries(Object.entries(props).map(([k, value]) => [k, { value, writable: true }])),
  );
  return { msg, replies, sent };
}

function registry(...cmds: UnifiedCommand[]) {
  const commands = new Map(cmds.map((c) => [c.name, c]));
  const aliases = new Map(cmds.flatMap((c) => (c.aliases ?? []).map((a) => [a, c] as const)));
  return [commands, aliases] as const;
}

function recorder() {
  const runs: any[] = [];
  const execute = async (ctx: any) => void runs.push(ctx);
  return { runs, execute };
}

describe("CommandHandler.handlePrefixCommand", () => {
  test("runs a command by name with parsed args", async () => {
    const r = recorder();
    const { msg } = message("-echo hello world");
    await CommandHandler.handlePrefixCommand(
      msg,
      ...registry({ name: "echo", description: "", options: [{ name: "text", description: "", type: "string" }], execute: r.execute }),
    );
    assert.equal(r.runs.length, 1);
    assert.equal(r.runs[0].getString("text"), "hello world");
  });

  test("is case-insensitive and resolves aliases", async () => {
    const r = recorder();
    await CommandHandler.handlePrefixCommand(
      message("-CFG").msg,
      ...registry({ name: "config", aliases: ["cfg"], description: "", execute: r.execute }),
    );
    assert.equal(r.runs.length, 1);
  });

  test("ignores messages without the prefix, bots and unknown commands", async () => {
    const r = recorder();
    const reg = registry({ name: "ping", description: "", execute: r.execute });
    await CommandHandler.handlePrefixCommand(message("ping").msg, ...reg);
    await CommandHandler.handlePrefixCommand(message("-nope").msg, ...reg);
    await CommandHandler.handlePrefixCommand(message("-ping", { author: { id: "b", bot: true } }).msg, ...reg);
    await CommandHandler.handlePrefixCommand(message("-").msg, ...reg);
    assert.equal(r.runs.length, 0);
  });

  test("routes subcommands, including subcommand aliases", async () => {
    const r = recorder();
    const reg = registry({
      name: "server",
      description: "",
      subcommands: [{ name: "config", aliases: ["cfg"], description: "", execute: r.execute }],
    });
    await CommandHandler.handlePrefixCommand(message("-server cfg").msg, ...reg);
    assert.equal(r.runs.length, 1);
  });

  test("rejects guild-only commands in DMs with an embed", async () => {
    const r = recorder();
    const { msg, replies } = message("-ping", { guild: null });
    await CommandHandler.handlePrefixCommand(msg, ...registry({ name: "ping", description: "", guildOnly: true, execute: r.execute }));
    assert.equal(r.runs.length, 0);
    assert.match(replies[0].embeds[0].data.description, /only be used in a server/);
  });

  test("rejects members without the required permissions", async () => {
    const r = recorder();
    const { msg, replies } = message("-ban", { member: { permissions: { has: () => false } } });
    await CommandHandler.handlePrefixCommand(
      msg,
      ...registry({ name: "ban", description: "", permissions: [8n], execute: r.execute }),
    );
    assert.equal(r.runs.length, 0);
    assert.match(replies[0].embeds[0].data.description, /do not have permission/);
  });

  test("enforces the cooldown per user", async () => {
    const r = recorder();
    const reg = registry({ name: "ping", description: "", cooldown: 60_000, execute: r.execute });
    const first = message("-ping");
    await CommandHandler.handlePrefixCommand(first.msg, ...reg);
    const again = message("-ping", { author: first.msg.author });
    await CommandHandler.handlePrefixCommand(again.msg, ...reg);
    assert.equal(r.runs.length, 1);
    assert.match(again.replies[0].embeds[0].data.description, /Please wait/);
  });

  test("a throwing command gets an error embed instead of crashing", async () => {
    const { msg, sent } = message("-boom");
    await CommandHandler.handlePrefixCommand(
      msg,
      ...registry({ name: "boom", description: "", execute: async () => { throw new Error("kaboom"); } }),
    );
    const last = sent.at(-1);
    assert.match(last.embeds[0].data.description, /error occurred/);
  });
});

describe("CommandHandler.handleSlashCommand", () => {
  function interaction(name: string, sub: string | null = null) {
    const replies: any[] = [];
    return {
      replies,
      i: {
        commandName: name,
        isChatInputCommand: () => true,
        user: { id: `slash${++userSeq}`, tag: "u#0" },
        guild: { id: "g" },
        memberPermissions: { has: () => true },
        options: { getSubcommand: () => sub },
        replied: false,
        deferred: false,
        reply: async (p: any) => void replies.push(p),
      } as any,
    };
  }

  test("unknown commands get an ephemeral error embed", async () => {
    const { i, replies } = interaction("missing");
    await CommandHandler.handleSlashCommand(i, new Map());
    assert.equal(replies[0].ephemeral, true);
    assert.match(replies[0].embeds[0].data.description, /not available/);
  });

  test("runs the matching subcommand", async () => {
    const r = recorder();
    const { i } = interaction("rolesync", "list");
    await CommandHandler.handleSlashCommand(
      i,
      new Map([["rolesync", { name: "rolesync", description: "", subcommands: [{ name: "list", description: "", execute: r.execute }] }]]),
    );
    assert.equal(r.runs.length, 1);
  });

  test("an unknown subcommand is rejected", async () => {
    const { i, replies } = interaction("rolesync", "nope");
    await CommandHandler.handleSlashCommand(
      i,
      new Map([["rolesync", { name: "rolesync", description: "", subcommands: [{ name: "list", description: "", execute: async () => {} }] }]]),
    );
    assert.match(replies[0].embeds[0].data.description, /Unknown subcommand/);
  });
});
