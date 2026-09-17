import { config } from "../../config/config.js";
import { logCommandError } from "../../middleware/commandLogger.js";
import { GuildConfigService } from "../../services/GuildConfigService.js";
import { SubCommand } from "../../types/UnifiedCommand.js";
import { createErrorEmbed } from "../../utils/formatters.js";

const status = process.argv[2] || "Active";

export default {
  name: "run",
  description: "Setup the server's configuration",
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
        const errorEmbed = createErrorEmbed(
          "Failed to update session status",
          "There was an error while trying to update the session status. Please try again later.",
        );
        await ctx.editReply({ embeds: [errorEmbed] });
        return;
      }
    } catch (error) {
      const errorEmbed = createErrorEmbed(
        "Failed to update session status",
        "There was an error while trying to update the session status. Please try again later.",
      );
      await logCommandError(ctx, "/session start", error).catch(() => {});
      await ctx.editReply({ embeds: [errorEmbed] });
      return;
    }
  },
} satisfies SubCommand;
