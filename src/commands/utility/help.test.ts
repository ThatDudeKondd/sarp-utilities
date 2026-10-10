import assert from "node:assert/strict";
import { test } from "node:test";
import help, { buildCategoryFields } from "./help.js";
import { setCommandRegistry } from "../../loaders/commandRegistry.js";

const cmd = (name: string, category?: string) => ({
  name,
  description: `${name} desc`,
  category,
  execute: async () => {},
});
const registry = [
  cmd("ping", "utility"),
  cmd("afk", "utility"),
  cmd("infract", "supervision"),
  cmd("misc", "newfolder"),
];

test("groups commands into categories in list order, unknown folders last", () => {
  const fields = buildCategoryFields(registry);
  assert.deepEqual(
    fields.map((f) => f.name),
    ["Utility", "Supervision", "newfolder"],
  );
  assert.equal(fields[0].value, "`/afk` - afk desc\n`/ping` - ping desc");
});

function run(category: string | null) {
  const replies: any[] = [];
  setCommandRegistry(new Map(registry.map((c) => [c.name, c])));
  const ctx: any = {
    getString: () => category,
    reply: async (p: any) => void replies.push(p),
  };
  return help.execute!(ctx).then(() => replies[0]);
}

test("/help <category> shows only that category, by id or display name", async () => {
  for (const arg of ["supervision", "Supervision"]) {
    const names = (await run(arg)).embeds[0].data.fields.map(
      (f: any) => f.name,
    );
    assert.deepEqual(names, ["Supervision", "Notes"]);
  }
});

test("unknown category lists the valid ones", async () => {
  assert.match(
    (await run("nope")).content,
    /Unknown category `nope`.*`utility`/,
  );
});
