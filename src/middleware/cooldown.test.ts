import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { checkCommandCooldown, getCooldown, getCooldownKey, hasCooldown, setCooldown } from "./cooldown.js";

describe("cooldown", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 }));
  afterEach(() => mock.timers.reset());

  test("keys are per user and per command", () => {
    assert.equal(getCooldownKey("u1", "ping"), "u1:ping");
  });

  test("no cooldown by default", () => {
    assert.equal(getCooldown("fresh", "ping"), 0);
    assert.equal(hasCooldown("fresh", "ping"), false);
  });

  test("counts down and expires", () => {
    setCooldown("u1", "ping", 3000);
    assert.equal(getCooldown("u1", "ping"), 3000);
    mock.timers.tick(1000);
    assert.equal(getCooldown("u1", "ping"), 2000);
    mock.timers.tick(2000);
    assert.equal(hasCooldown("u1", "ping"), false);
  });

  test("is isolated between users and commands", () => {
    setCooldown("u2", "ping", 3000);
    assert.equal(hasCooldown("u2", "afk"), false);
    assert.equal(hasCooldown("u3", "ping"), false);
  });

  test("checkCommandCooldown allows once, then reports remaining seconds", async () => {
    const reported: string[] = [];
    const onCooldown = async (s: string) => void reported.push(s);
    assert.equal(await checkCommandCooldown("u4", "ping", 3000, onCooldown), true);
    mock.timers.tick(500);
    assert.equal(await checkCommandCooldown("u4", "ping", 3000, onCooldown), false);
    assert.deepEqual(reported, ["2.5"]);
    mock.timers.tick(2500);
    assert.equal(await checkCommandCooldown("u4", "ping", 3000, onCooldown), true);
  });
});
