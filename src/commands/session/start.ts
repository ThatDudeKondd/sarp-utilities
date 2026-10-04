import { config } from "../../config/config.js";
import { SUPER_ADMIN_ID } from "../../config/constants.js";
import { logCommandError } from "../../middleware/commandLogger.js";
import { GuildConfigService } from "../../services/GuildConfigService.js";
import { SubCommand } from "../../types/UnifiedCommand.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/formatters.js";

export default {
  name: "start",
  description: "Start an in-game session and update the public session status.",
  options: [
    {
      name: "status",
      description: 'Session status to publish (default "Active", "null" clears it).',
      type: "string",
      required: false,
    },
  ],
  execute: async (ctx) => {
    await ctx.defer();

    const guildConfig = await GuildConfigService.getConfig(
      ctx.guild?.id as string,
    );

    const canRunRoles = [
      ...(guildConfig.directiveRoles || []),
      ...(guildConfig.seniorHrRoles || []),
      ...(guildConfig.managementRoles || []),
      ...(guildConfig.supervisorRoles || []),
    ];
    const hasRunPerms =
      ctx.user.id === SUPER_ADMIN_ID ||
      ctx.member?.roles?.cache.some((role) => canRunRoles.includes(role.id));

    if (!hasRunPerms) {
      const errorEmbed = createErrorEmbed(
        "You do not have permission to run this command.",
        "This command is restricted to Supervisor+.",
      );
      await ctx.editReply({ embeds: [errorEmbed] });
      return;
    }

    const status = ctx.getString("status")?.trim() || "Active";

    const failedEmbed = createErrorEmbed(
      "Failed to update session status",
      "There was an error while trying to update the session status. Please try again later.",
    );

    try {
      const response = await fetch(
        `${config.vixeraPortfolioUrl}/data/sessions/sessions.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.vexiraPortfolioKey}`,
            "X-Bot-Id": config.clientId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: status === "null" ? null : status }),
        },
      );
      if (!response.ok) {
        throw new Error(`Session status API returned ${response.status}`);
      }
    } catch (error) {
      await logCommandError(ctx, "/session start", error).catch(() => {});
      await ctx.editReply({ embeds: [failedEmbed] });
      return;
    }

    const successEmbed = createSuccessEmbed(
      "Session status updated",
      status === "null"
        ? "The session status has been cleared."
        : `The session status is now **${status}**.`,
    );
    await ctx.editReply({ embeds: [successEmbed] });
  },
} satisfies SubCommand;
