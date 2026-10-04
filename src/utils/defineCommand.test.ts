import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildSlashCommandData, defineCommand } from "./defineCommand.js";
import rolesync from "../commands/rolesync/index.js";

describe("buildSlashCommandData", () => {
  test("maps every option type onto the slash builder", () => {
    const types = ["string", "integer", "number", "boolean", "user", "channel", "role"] as const;
    const json = buildSlashCommandData(
      defineCommand({
        name: "t",
        description: "d",
        options: types.map((type, i) => ({ name: `o${i}`, description: "x", type, required: i === 0 })),
      }),
    ).toJSON();
    assert.equal(json.options?.length, types.length);
    assert.equal((json.options![0] as any).required, true);
    assert.equal((json.options![1] as any).required, false);
  });

  test("adds string choices", () => {
    const json = buildSlashCommandData(
      defineCommand({
        name: "t",
        description: "d",
        options: [{ name: "c", description: "x", type: "string", choices: [{ name: "A", value: "a" }] }],
      }),
    ).toJSON();
    const choices = (json.options![0] as any).choices.map(({ name, value }: any) => ({ name, value }));
    assert.deepEqual(choices, [{ name: "A", value: "a" }]);
  });

  test("builds subcommands with their own options", () => {
    const json = buildSlashCommandData(rolesync).toJSON();
    const names = json.options!.map((o) => o.name);
    assert.deepEqual(names, ["link", "unlink", "list"]);
  });

  test("rolesync link exposes the readable option names and a direction choice", () => {
    const link: any = buildSlashCommandData(rolesync).toJSON().options!.find((o) => o.name === "link");
    assert.deepEqual(
      link.options.map((o: any) => o.name),
      ["this_server_role", "other_server_id", "other_server_role_id", "direction"],
    );
    const direction = link.options.find((o: any) => o.name === "direction");
    assert.equal(direction.required, false);
    assert.deepEqual(
      direction.choices.map((c: any) => c.value),
      ["both", "to_here", "to_other"],
    );
  });
});
