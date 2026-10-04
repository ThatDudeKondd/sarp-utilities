import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, test } from "node:test";
import configuration from "./configuration.js";
import { stubPrisma } from "../../test/fakes.js";

const baseConfig = () => ({
  guildId: "g",
  prefix: "-",
  directiveRoles: [],
  seniorHrRoles: [],
  managementRoles: [],
  supervisorRoles: ["sup"],
  administratorRoles: [],
  moderatorRoles: [],
  infractionChannel: "",
  logsChannel: "logs",
  erlcLogChannel: "",
});

let db: ReturnType<typeof baseConfig> | null;
let restore = () => {};
beforeEach(() => {
  db = baseConfig();
  restore = stubPrisma("guildConfig", {
    findUnique: async () => db,
    upsert: async ({ update }: any) => (db = { ...db!, ...update }),
  });
});
afterEach(() => restore());

/** Opens the panel as an admin and returns handles to drive it. */
async function openPanel({ admin = true } = {}) {
  const collector = Object.assign(new EventEmitter(), {
    stopped: "" as string,
    stop(reason: string) {
      this.stopped = reason;
    },
    resetTimer() {},
  });
  const message: any = {
    deleted: false,
    edits: [] as any[],
    createMessageComponentCollector: () => collector,
    delete: async () => void (message.deleted = true),
    edit: async (p: any) => void message.edits.push(p),
  };
  const views: any[] = [];
  const ctx: any = {
    guild: { id: "g" },
    user: { id: "admin", tag: "admin#0" },
    member: { permissions: { has: () => admin } },
    deferred: true,
    defer: async () => {},
    editReply: async (p: any) => {
      views.push(p);
      return message;
    },
  };
  await configuration.execute(ctx);
  return { ctx, collector, message, views };
}

/** Fires one component interaction at the collector and waits for the handler. */
async function click(collector: EventEmitter, customId: string, extra: Record<string, unknown> = {}) {
  const i: any = {
    customId,
    user: { id: "admin" },
    updates: [] as any[],
    replies: [] as any[],
    update: async (p: any) => void i.updates.push(p),
    reply: async (p: any) => void i.replies.push(p),
    deferUpdate: async () => {},
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    ...extra,
  };
  collector.emit("collect", i);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return i;
}

const title = (view: any) => view.embeds[0].data.title as string;
const fieldNames = (view: any) => view.embeds[0].data.fields.map((f: any) => f.name);
const buttonIds = (view: any) => view.components.flatMap((row: any) => row.components.map((c: any) => c.data.custom_id));
const disabled = (view: any, id: string) =>
  view.components.flatMap((r: any) => r.components).find((c: any) => c.data.custom_id === id).data.disabled;

describe("-server config panel", () => {
  test("opens on the Roles page with current values, tabs and Cancel", async () => {
    const { views } = await openPanel();
    assert.match(title(views[0]), /Roles/);
    assert.ok(fieldNames(views[0]).includes("Supervisor Roles"));
    assert.ok(views[0].embeds[0].data.fields.some((f: any) => f.value === "<@&sup>"));
    assert.ok(buttonIds(views[0]).includes("cfg_cancel"));
    assert.equal(disabled(views[0], "cfg_page_roles"), true);
    assert.equal(disabled(views[0], "cfg_page_channels"), false);
  });

  test("the Channels page lists every channel setting, including the ER:LC log channel", async () => {
    const { collector } = await openPanel();
    const i = await click(collector, "cfg_page_channels");
    assert.deepEqual(fieldNames(i.updates[0]), ["Infraction Channel", "Logs Channel", "ER:LC Log Channel"]);
    assert.equal(i.updates[0].embeds[0].data.fields[1].value, "<#logs>");
    assert.equal(i.updates[0].embeds[0].data.fields[2].value, "Not set");
  });

  test("Misc shows the prefix", async () => {
    const { collector } = await openPanel();
    const i = await click(collector, "cfg_page_misc");
    assert.equal(i.updates[0].embeds[0].data.fields[0].value, "`-`");
    assert.ok(buttonIds(i.updates[0]).includes("cfg_edit_prefix"));
  });

  test("editing shows a picker with Back and Cancel; Back returns to the page", async () => {
    const { collector } = await openPanel();
    const edit = await click(collector, "cfg_edit_supervisorRoles");
    assert.deepEqual(buttonIds(edit.updates[0]).filter(Boolean).slice(-2), ["cfg_back", "cfg_cancel"]);
    const back = await click(collector, "cfg_back");
    assert.match(title(back.updates[0]), /Roles/);
  });

  test("selecting roles saves them and returns to the Roles page", async () => {
    const { collector } = await openPanel();
    await click(collector, "cfg_edit_moderatorRoles");
    const pick = await click(collector, "cfg_select_moderatorRoles", { isRoleSelectMenu: () => true, values: ["m1", "m2"] });
    assert.deepEqual(db!.moderatorRoles, ["m1", "m2"]);
    assert.match(title(pick.updates[0]), /Roles/);
  });

  test("selecting a channel saves it and returns to the Channels page; empty clears it", async () => {
    const { collector } = await openPanel();
    await click(collector, "cfg_page_channels");
    const pick = await click(collector, "cfg_select_erlcLogChannel", { isChannelSelectMenu: () => true, values: ["c9"] });
    assert.equal(db!.erlcLogChannel, "c9");
    assert.match(title(pick.updates[0]), /Channels/);
    await click(collector, "cfg_select_erlcLogChannel", { isChannelSelectMenu: () => true, values: [] });
    assert.equal(db!.erlcLogChannel, "");
  });

  test("Cancel deletes the panel and stops listening", async () => {
    const { collector, message } = await openPanel();
    await click(collector, "cfg_cancel");
    assert.equal(message.deleted, true);
    assert.equal(collector.stopped, "cancelled");
  });

  test("other users are turned away privately and change nothing", async () => {
    const { collector } = await openPanel();
    const i = await click(collector, "cfg_select_moderatorRoles", {
      user: { id: "intruder" },
      isRoleSelectMenu: () => true,
      values: ["x"],
    });
    assert.deepEqual(db!.moderatorRoles, []);
    assert.equal(i.replies[0].flags, 64);
  });

  test("the prefix modal rejects spaces and saves a valid prefix", async () => {
    const { collector } = await openPanel();
    const submit = (value: string) => {
      const modal: any = {
        isFromMessage: () => true,
        fields: { getTextInputValue: () => value },
        replies: [] as any[],
        updates: [] as any[],
        reply: async (p: any) => void modal.replies.push(p),
        update: async (p: any) => void modal.updates.push(p),
      };
      return modal;
    };
    let modal = submit("a b");
    await click(collector, "cfg_edit_prefix", { showModal: async () => {}, awaitModalSubmit: async () => modal });
    assert.equal(db!.prefix, "-");
    assert.match(modal.replies[0].embeds[0].data.description, /can't be empty or contain spaces/);

    modal = submit("!");
    await click(collector, "cfg_edit_prefix", { showModal: async () => {}, awaitModalSubmit: async () => modal });
    assert.equal(db!.prefix, "!");
    assert.match(title(modal.updates[0]), /Misc|Roles/);
  });

  test("an idle timeout closes the panel with a notice", async () => {
    const { collector, message } = await openPanel();
    collector.emit("end", new Map(), "idle");
    await new Promise((r) => setImmediate(r));
    assert.match(message.edits[0].embeds[0].data.title, /closed/);
    assert.deepEqual(message.edits[0].components, []);
  });

  test("non-admins can't open it", async () => {
    await assert.rejects(openPanel({ admin: false }), /administrator/);
  });

  test("servers that never ran setup get told to", async () => {
    db = null;
    const { views } = await openPanel();
    assert.match(views[0].content, /has not been set up/);
  });
});
