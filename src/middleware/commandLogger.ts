import { EmbedBuilder } from "discord.js";
import { CommandContext } from "../utils/commandContext.js";
import { CONSTANTS, ERROR_ALERT_ROLE_ID } from "../config/constants.js";
import { sendToLogsChannel } from "../utils/logChannel.js";
import { truncateString } from "../utils/formatters.js";

/**
 * Logs a command/interaction execution to the invoking guild's logs
 * channel (set via /server setup or /server configuration). No-ops in
 * DMs, since there's no guild config to look up there.
 */
export async function logCommandExecution(
  ctx: CommandContext,
  commandDisplay: string,
): Promise<void> {
  const guild = ctx.guild;
  if (!guild) return;

  const embed = new EmbedBuilder()
    .setTitle("⚡ Command Executed")
    .addFields(
      { name: "Command", value: `\`${commandDisplay}\``, inline: true },
      {
        name: "User",
        value: `${ctx.user} (\`${ctx.user.id}\`)`,
        inline: true,
      },
      {
        name: "Channel",
        value: ctx.channel ? `<#${ctx.channel.id}>` : "Unknown",
        inline: true,
      },
    )
    .setColor(CONSTANTS.EMBED_COLOR)
    .setTimestamp();

  await sendToLogsChannel(guild, embed);
}

/**
 * Logs a command/interaction that threw during execution to the same logs
 * channel, with the error message included. Same DM no-op as above.
 */
export async function logCommandError(
  ctx: CommandContext,
  commandDisplay: string,
  error: unknown,
): Promise<void> {
  const guild = ctx.guild;
  if (!guild) return;

  const errorMessage = error instanceof Error ? error.message : String(error);

  const embed = new EmbedBuilder()
    .setTitle("❌ Command Error")
    .addFields(
      { name: "Command", value: `\`${commandDisplay}\``, inline: true },
      {
        name: "User",
        value: `${ctx.user} (\`${ctx.user.id}\`)`,
        inline: true,
      },
      {
        name: "Channel",
        value: ctx.channel ? `<#${ctx.channel.id}>` : "Unknown",
        inline: true,
      },
      {
        name: "Error",
        value: `\`\`\`${truncateString(errorMessage, 1000)}\`\`\``,
      },
    )
    .setColor(CONSTANTS.EMBED_ERROR_COLOR)
    .setTimestamp();

  await sendToLogsChannel(
    guild,
    embed,
    ERROR_ALERT_ROLE_ID ? `<@&${ERROR_ALERT_ROLE_ID}>` : undefined,
  );
}
