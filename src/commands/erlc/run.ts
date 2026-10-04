import { SubCommand } from "../../types/UnifiedCommand.js";
import {
  createErrorEmbed,
  createSuccessEmbed,
  truncateString,
} from "../../utils/formatters.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/config.js";
import { ErlcServerInfo, SUPER_ADMIN_ID } from "../../config/constants.js";
import { MessageFlags } from "discord.js";
import { GuildConfigService } from "../../services/GuildConfigService.js";
import { logCommandError } from "../../middleware/commandLogger.js";

/** Friendly messages for the ERLC `/command` endpoint's documented error codes. */
const ERLC_COMMAND_ERRORS: Record<number, string> = {
  400: "Invalid command provided.",
  422: "The in-game server is currently offline.",
  500: "An error occurred while communicating with the in-game server.",
};

export default {
  name: "run",
  description: "Run a command in the in-game ER:LC server.",
  options: [
    {
      name: "command",
      description: "The command to be ran in the in-game server.",
      type: "string",
      required: true,
    },
  ],
  execute: async (ctx) => {
    await ctx.defer();

    const guildConfig = await GuildConfigService.getConfig(
      ctx.guild?.id as string,
    );

    const isSuperAdmin = ctx.user.id === SUPER_ADMIN_ID;

    const canRunRoles = [
      ...(guildConfig.directiveRoles || []),
      ...(guildConfig.seniorHrRoles || []),
      ...(guildConfig.managementRoles || []),
      ...(guildConfig.supervisorRoles || []),
    ];

    const hasRunPerms =
      isSuperAdmin ||
      ctx.member?.roles?.cache.some((role) => canRunRoles.includes(role.id));

    if (!hasRunPerms) {
      const errorEmbed = createErrorEmbed(
        "You do not have permission to run this command.",
        "This command can only be run by staff members.",
      );
      await ctx.editReply({ embeds: [errorEmbed] });
      return;
    }

    let command = ctx.getString("command");
    if (!command) {
      const embed = createErrorEmbed(
        "Invalid Command",
        "Please provide a valid command to run.",
      );
      await ctx.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (command.charAt(0) !== ":") {
      command = `:${command}`;
    }

    const body = JSON.stringify({ command: command.toString() });
    const options = { ...config.postOptions, body };

    try {
      const response = await fetch(`${config.erlcApiBaseUrl}/command`, options);
      if (!response.ok) {
        const text = await response.text().catch(() => null);
        const reason = ERLC_COMMAND_ERRORS[response.status];
        throw new Error(
          reason ??
            `ERLC API returned ${response.status}${text ? ` - ${text}` : ""}`,
        );
      }

      const statsResponse = await fetch(
        `${config.erlcApiBaseUrl}`,
        config.getOptions,
      );
      if (!statsResponse.ok) {
        const text = await statsResponse.text().catch(() => null);
        throw new Error(
          `ERLC API Stats returned ${statsResponse.status}${text ? ` - ${text}` : ""}`,
        );
      }
      const serverData = (await statsResponse.json()) as ErlcServerInfo;
      const serverName = serverData.Name || "ERLC Server";

      const embed = createSuccessEmbed(
        serverName,
        `> **Command:** \`${truncateString(command)}\`\n > **Executed By:** <@${ctx.user.id}>\n > **Output:** Sent successfully`,
      );
      await ctx.editReply({ content: "", embeds: [embed], components: [] });
    } catch (error) {
      logger.error(`Error running ERLC command:`, error);
      await logCommandError(ctx, "/erlc run", error).catch(() => {});
      const embed = createErrorEmbed(
        "Failed to run ERLC command",
        error instanceof Error ? error.message : "An unknown error occurred.",
      );

      try {
        if (ctx.deferred || ctx.replied) {
          await ctx.editReply({ embeds: [embed] });
        } else {
          await ctx.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
      } catch (replyError) {
        try {
          await ctx.reply({
            content: "Failed to run ERLC command.",
            flags: MessageFlags.Ephemeral,
          });
        } catch (followErr) {
          logger.error("Failed to send error reply:", {
            replyError,
            followErr,
          });
        }
      }
    }
  },
} satisfies SubCommand;
