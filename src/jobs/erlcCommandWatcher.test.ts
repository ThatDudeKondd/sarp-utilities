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
