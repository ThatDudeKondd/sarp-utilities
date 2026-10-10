import { EmbedBuilder, MessageFlags } from "discord.js";
import { defineCommand } from "../../utils/defineCommand.js";
import { CONSTANTS } from "../../config/constants.js";
import { getCommandRegistry } from "../../loaders/commandRegistry.js";
import { UnifiedCommand, CommandOption } from "../../types/UnifiedCommand.js";

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

export default defineCommand({
  name: "help",
  description:
    "Help command, shows information about the bot and it's commands.",
  aliases: [],
  cooldown: 1000,
  execute: async (ctx) => {
    const commands = getCommandRegistry().sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    // Embed field values cap at 1024 chars, so split the list across as many fields as needed.
    const commandFields: { name: string; value: string; inline: boolean }[] =
      [];
    for (const line of commands.map(formatCommand).join("\n").split("\n")) {
      const last = commandFields.at(-1);
      if (last && last.value.length + line.length + 1 <= 1024) {
        last.value += "\n" + line;
      } else {
        commandFields.push({
          name: commandFields.length ? "\u200b" : "Commands",
          value: line,
          inline: false,
        });
      }
    }

    const helpEmbed = new EmbedBuilder()
      .setTitle("SARP Utils Help")
      .setDescription(
        "Browse every available command for SARP Utils. Commands can be used through slash commands or the configured prefix.",
      )
      .setColor(CONSTANTS.EMBED_COLOR)
      .addFields(...commandFields, {
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
