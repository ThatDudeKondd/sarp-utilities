import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONSTANTS } from "../config/constants.js";
import {
  asEmbed,
  baseEmbed,
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  createWarningEmbed,
  isPartialMatch,
  truncateString,
} from "./formatters.js";

describe("asEmbed", () => {
  test("turns plain content into a blurple embed and clears the content", () => {
    const out = asEmbed({ content: "hello" });
    assert.equal(out.content, "");
    assert.equal(out.embeds!.length, 1);
    const data = (out.embeds![0] as any).data;
    assert.equal(data.description, "hello");
    assert.equal(data.color, CONSTANTS.EMBED_COLOR);
  });

  test("uses the error colour for ❌ messages", () => {
    const data = (asEmbed({ content: "❌ nope" }).embeds![0] as any).data;
    assert.equal(data.color, CONSTANTS.EMBED_ERROR_COLOR);
  });

  test("keeps other payload fields (flags, ephemeral, allowedMentions)", () => {
    const out = asEmbed({ content: "x", flags: 64, ephemeral: true, allowedMentions: { parse: [] } });
    assert.equal(out.flags, 64);
    assert.equal(out.ephemeral, true);
    assert.deepEqual(out.allowedMentions, { parse: [] });
  });

  test("passes payloads that already have embeds through untouched", () => {
    const payload = { content: "<@1>", embeds: [{}] };
    assert.equal(asEmbed(payload), payload);
  });

  test("passes payloads without content through untouched", () => {
    const payload = { components: [] as unknown[] };
    assert.equal(asEmbed(payload as any), payload);
  });

  test("converts when embeds is an empty array", () => {
    assert.equal(asEmbed({ content: "x", embeds: [] }).embeds!.length, 1);
  });
});

describe("embed builders", () => {
  test("baseEmbed sets colour, footer and timestamp", () => {
    const data = baseEmbed(0x123456).data;
    assert.equal(data.color, 0x123456);
    assert.equal(data.footer?.text, CONSTANTS.EMBED_FOOTER_TEXT);
    assert.ok(data.timestamp);
  });

  for (const [fn, color, icon] of [
    [createSuccessEmbed, CONSTANTS.EMBED_SUCCESS_COLOR, "✅"],
    [createErrorEmbed, CONSTANTS.EMBED_ERROR_COLOR, "❌"],
    [createWarningEmbed, CONSTANTS.EMBED_WARNING_COLOR, "⚠️"],
  ] as const) {
    test(`${fn.name} uses ${icon} and its colour`, () => {
      const data = fn("Title", "Body").data;
      assert.equal(data.title, `${icon}  Title`);
      assert.equal(data.description, "Body");
      assert.equal(data.color, color);
    });
  }

  test("createInfoEmbed caps fields at MAX_EMBED_FIELDS", () => {
    const fields = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, value: "v" }));
    const data = createInfoEmbed("T", "D", fields).data;
    assert.equal(data.fields?.length, CONSTANTS.MAX_EMBED_FIELDS);
  });

  test("createInfoEmbed without fields adds none", () => {
    assert.equal(createInfoEmbed("T", "D").data.fields, undefined);
  });
});

describe("truncateString", () => {
  test("leaves short strings alone", () => {
    assert.equal(truncateString("abc", 5), "abc");
    assert.equal(truncateString("abcde", 5), "abcde");
  });

  test("cuts long strings to exactly maxLength with an ellipsis", () => {
    const out = truncateString("abcdefghij", 6);
    assert.equal(out, "abc...");
    assert.equal(out.length, 6);
  });

  test("defaults to the embed field limit", () => {
    assert.equal(truncateString("x".repeat(5000)).length, CONSTANTS.MAX_FIELD_LENGTH);
  });
});

describe("isPartialMatch", () => {
  test("is a case-insensitive prefix match", () => {
    assert.equal(isPartialMatch("ad", "Administrator"), true);
    assert.equal(isPartialMatch("ADMIN", "administrator"), true);
    assert.equal(isPartialMatch("min", "administrator"), false);
  });
});
