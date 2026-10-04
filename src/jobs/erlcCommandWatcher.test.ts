import assert from "node:assert/strict";
import { test } from "node:test";
import { massCommandOffender } from "./erlcCommandWatcher.js";

const entry = (Command: string, Player = "Bad:123") => ({ Player, Timestamp: 0, Command });

test("flags dangerous commands aimed at everyone", () => {
  assert.equal(massCommandOffender(entry(":ban all trolling")), "123");
  assert.equal(massCommandOffender(entry(":UNMOD ALL")), "123");
  assert.equal(massCommandOffender(entry(":kick others")), "123");
  assert.equal(massCommandOffender(entry(":unadmin all", "Name:With:Colons:456")), "456");
});

test("ignores single targets, harmless commands and non-player sources", () => {
  assert.equal(massCommandOffender(entry(":ban someone")), null);
  assert.equal(massCommandOffender(entry(":h all hello")), null);
  assert.equal(massCommandOffender(entry(":ban")), null);
  assert.equal(massCommandOffender(entry(":ban all", "Remote Server")), null);
});

// --- The polling loop, end to end, with a fake ER:LC API and fake timers. ---
import { afterEach, beforeEach, describe, mock } from "node:test";
import { startErlcCommandWatcher } from "./erlcCommandWatcher.js";
import { stubPrisma } from "../test/fakes.js";

describe("startErlcCommandWatcher", () => {
  const START = 1_700_000_000; // unix seconds when the watcher starts
  let requests: { url: string; method: string; body?: string }[];
  let responses: (() => Response)[];
  let posts: any[];
  let client: any;
  let restorePrisma = () => {};
  const realFetch = globalThis.fetch;

  const logs = (...entries: [string, number, string][]) => () =>
    Response.json({ CommandLogs: entries.map(([Command, dt, Player]) => ({ Command, Timestamp: START + dt, Player })) });

  /** Lets pending promise chains (fetch → json → send) run. */
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  };

  beforeEach(() => {
    process.env.ERLC_API_KEY = "test-key";
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: START * 1000 });
    requests = [];
    responses = [];
    posts = [];
    globalThis.fetch = (async (url: string, init: any = {}) => {
      requests.push({ url: String(url), method: init.method ?? "GET", body: init.body });
      if (init.method === "POST") return new Response("{}", { status: 200 });
      return (responses.shift() ?? logs())();
    }) as typeof fetch;
    restorePrisma = stubPrisma("guildConfig", {
      findMany: async () => [{ erlcLogChannel: "chan", supervisorRoles: ["sup1", "sup2"] }],
    });
    client = { channels: { fetch: async () => ({ isSendable: () => true, send: async (p: any) => void posts.push(p) }) } };
  });

  afterEach(() => {
    mock.timers.reset();
    globalThis.fetch = realFetch;
    restorePrisma();
  });

  test("posts only commands newer than startup, and doesn't repeat them", async () => {
    responses.push(logs([":h old", -60, "A:1"], [":h new", 1, "A:1"]));
    startErlcCommandWatcher(client);
    await settle();
    assert.equal(posts.length, 1);
    assert.match(posts[0].embeds[0].data.description, /:h new/);
    assert.doesNotMatch(posts[0].embeds[0].data.description, /:h old/);
    assert.equal(posts[0].content, undefined); // routine log never pings

    responses.push(logs([":h new", 1, "A:1"]));
    mock.timers.tick(10_000);
    await settle();
    assert.equal(posts.length, 1);
  });

  test("keeps distinct commands that share the same second", async () => {
    responses.push(logs([":h one", 1, "A:1"]));
    startErlcCommandWatcher(client);
    await settle();
    responses.push(logs([":h one", 1, "A:1"], [":h two", 1, "B:2"]));
    mock.timers.tick(10_000);
    await settle();
    assert.equal(posts.length, 2);
    assert.match(posts[1].embeds[0].data.description, /:h two/);
  });

  test("a mass command strips mod and admin by Roblox ID and pings supervisors", async () => {
    responses.push(logs([":ban all trolling", 2, "Bad:123"]));
    startErlcCommandWatcher(client);
    await settle();
    mock.timers.tick(5_500);
    await settle();
    mock.timers.tick(5_500);
    await settle();

    const commands = requests.filter((r) => r.method === "POST").map((r) => JSON.parse(r.body!).command);
    assert.deepEqual(commands, [":unmod 123", ":unadmin 123"]);

    const alert = posts.find((p) => p.embeds[0].data.title?.includes("Mass command"));
    assert.ok(alert, "alert posted");
    assert.equal(alert.content, "<@&sup1> <@&sup2>");
    assert.deepEqual(alert.allowedMentions, { roles: ["sup1", "sup2"] });
    assert.match(alert.embeds[0].data.description, /`:unmod 123`: ok/);
  });

  test("ordinary single-target commands don't trigger anything", async () => {
    responses.push(logs([":ban someone", 1, "Mod:9"]));
    startErlcCommandWatcher(client);
    await settle();
    mock.timers.tick(20_000);
    await settle();
    assert.equal(requests.filter((r) => r.method === "POST").length, 0);
  });

  test("waits out a 429 before polling again", async () => {
    responses.push(() => new Response("{}", { status: 429, headers: { "retry-after": "30" } }));
    startErlcCommandWatcher(client);
    await settle();
    const afterFirst = requests.length;
    mock.timers.tick(20_000); // still inside Retry-After
    await settle();
    assert.equal(requests.length, afterFirst);
    mock.timers.tick(10_000); // Retry-After (30s) done; the next poll is scheduled now
    await settle();
    mock.timers.tick(10_000); // the regular 10s poll interval
    await settle();
    assert.ok(requests.length > afterFirst);
  });

  test("does nothing without ERLC_API_KEY", async () => {
    delete process.env.ERLC_API_KEY;
    startErlcCommandWatcher(client);
    await settle();
    assert.equal(requests.length, 0);
  });
});
