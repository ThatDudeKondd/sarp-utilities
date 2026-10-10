import { EmbedBuilder, MessageFlags } from "discord.js";
import { defineCommand } from "../../utils/defineCommand.js";
import { CONSTANTS } from "../../config/constants.js";
import { getCommandRegistry } from "../../loaders/commandRegistry.js";
import { UnifiedCommand, CommandOption } from "../../types/UnifiedCommand.js";

/**
 * Help categories, in display order. `id` is the folder under src/commands;
 * these also become the choices of `/help [category]`. A folder missing here
 * still shows up (titled by its folder name), just last.
 */
export const CATEGORIES = [
  { id: "utility", name: "Utility" },
  { id: "server", name: "Server" },
  { id: "session", name: "Sessions" },
  { id: "erlc", name: "ER:LC" },
  { id: "supervision", name: "Supervision" },
  { id: "rolesync", name: "Role Sync" },
];

/** Renders a command/subcommand's declared options as a usage-hint suffix, e.g. " <user> <reason> [duration]". */
function formatOptions(options?: CommandOption[]): string {
  if (!options?.length) return "";

  return (
    " " +
    options
      .map((opt) => (opt.required ? `<${opt.name}>` : `[${opt.name}]`))
      .join(" ")
  );
}

/** Renders one command's line in the help embed, including its subcommands if any. */
function formatCommand(command: UnifiedCommand): string {
  if (command.subcommands?.length) {
    return command.subcommands
      .map(
        (sub) =>
          `\`/${command.name} ${sub.name}${formatOptions(sub.options)}\` - ${sub.description}`,
      )
      .join("\n");
  }

  return `\`/${command.name}${formatOptions(command.options)}\` - ${command.description}`;
}

/** One embed field per category that has commands, in CATEGORIES order. */
export function buildCategoryFields(commands: UnifiedCommand[]) {
  const ids = [
    ...CATEGORIES.map((c) => c.id),
    ...new Set(commands.map((c) => c.category ?? "other")),
  ];

  return [...new Set(ids)].flatMap((id) => {
    const inCategory = commands
      .filter((c) => (c.category ?? "other") === id)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!inCategory.length) return [];

    return [
      {
        name: CATEGORIES.find((c) => c.id === id)?.name ?? id,
        // ponytail: no chunking; a single category would need ~15 long commands to pass 1024 chars.
        value: inCategory.map(formatCommand).join("\n"),
        inline: false,
      },
    ];
  });
}

export default defineCommand({
  name: "help",
  description:
    "Help command, shows information about the bot and it's commands.",
  aliases: [],
  cooldown: 1000,
  options: [
    {
      name: "category",
      description: "Only show commands from this category",
      type: "string",
      required: false,
      choices: CATEGORIES.map((c) => ({ name: c.name, value: c.id })),
    },
  ],
  execute: async (ctx) => {
    const wanted = ctx.getString("category")?.toLowerCase() ?? null;
    let fields = buildCategoryFields(getCommandRegistry());

    // Prefix args aren't checked against the choices, so match by id or display name.
    if (wanted) {
      const category = CATEGORIES.find(
        (c) => c.id === wanted || c.name.toLowerCase() === wanted,
      );
      fields = fields.filter((f) => f.name === (category?.name ?? wanted));

      if (!fields.length) {
        await ctx.reply({
          content: `Unknown category \`${wanted}\`. Categories: ${CATEGORIES.map((c) => `\`${c.id}\``).join(", ")}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const helpEmbed = new EmbedBuilder()
      .setTitle("SARP Utils Help")
      .setDescription(
        "Browse every available command for SARP Utils. Commands can be used through slash commands or the configured prefix. Use `/help <category>` to show a single category.",
      )
      .setColor(CONSTANTS.EMBED_COLOR)
      .addFields(...fields, {
        name: "Notes",
        value:
          "Some commands require specific server role permissions. Only supervisors+ or configured SARP roles can manage server setup and run SARP actions.",
        inline: false,
      })
      .setFooter({ text: "SARP Utils • Use commands for more details" })
      .setTimestamp();

    await ctx.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
  },
});
