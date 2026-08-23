import { SubCommand } from "../../types/UnifiedCommand.js";
import { config } from "../../config/config.js";
import { baseEmbed, createErrorEmbed } from "../../utils/formatters.js";
import {
  CONSTANTS,
  ErlcServerInfo,
  RobloxAPIResponse,
} from "../../config/constants.js";
import { logger } from "../../utils/logger.js";
import { MessageFlags } from "discord.js";
import { GuildConfigService } from "../../services/GuildConfigService.js";
import { logCommandError } from "../../middleware/commandLogger.js";

export default {
  name: "players",
  description: "Get a list of players currently in-game.",
  options: [
    {
      name: "username",
      description: "The username of a player to search for.",
      type: "string",
      required: false,
    },
  ],
  execute: async (ctx) => {
    await ctx.defer();

    const indexUsername = ctx.getString("username")?.toLowerCase() || null;

    const guildConfig = await GuildConfigService.getConfig(
      ctx.guild?.id as string,
    );

    const canRunRoles = [
      ...(guildConfig.directiveRoles || []),
      ...(guildConfig.seniorHrRoles || []),
      ...(guildConfig.managementRoles || []),
      ...(guildConfig.supervisorRoles || []),
      ...(guildConfig.administratorRoles || []),
      ...(guildConfig.moderatorRoles || []),
    ];
    const hasRunPerms = ctx.member?.roles?.cache.some((role) =>
      canRunRoles.includes(role.id),
    );

    if (!hasRunPerms) {
      const errorEmbed = createErrorEmbed(
        "You do not have permission to run this command.",
        "This command can only be run by staff members.",
      );
      await ctx.editReply({ embeds: [errorEmbed] });
      return;
    }

    const fetchRobloxUsername = async (userId: number) => {
      try {
        const response = await fetch(
          `https://users.roblox.com/v1/users/${encodeURIComponent(userId)}`,
        );
        if (!response.ok) {
          throw new Error(
            `Failed to fetch Roblox user page for user ID ${userId}`,
          );
        }
        const info = (await response.json()) as RobloxAPIResponse;
        return info.name || "Unknown";
      } catch (error) {
        logger.warn(`Failed to fetch Roblox username for: ${userId}.`, error);
        return "Unknown";
      }
    };

    const makeRobloxProfileLink = async (id: number, team: string) => {
      const userId = String(id);
      const username = (await fetchRobloxUsername(id)) || id;
      const profileUrl = config.robloxUserPageUrl.replace("<USER_ID>", userId);
      return `[${username}(${team})](${profileUrl})`;
    };

    try {
      const response = await fetch(
        `${config.erlcApiBaseUrl}?Players=true`,
        config.getOptions,
      );
      if (!response.ok) {
        const apiErrEmbed = createErrorEmbed(
          "ERLC API Failed to fetch players",
          `The ERLC API returned a ${response.status} error. Please report this to directive and try again later.`,
        );
        await ctx.editReply({ embeds: [apiErrEmbed] });
        throw new Error(`ERLC API Error returned ${response.status}`);
      }

      const data = (await response.json()) as ErlcServerInfo;
      const players = Array.isArray(data.Players)
        ? data.Players
        : data.Players || [];
      let staff = [];
      let nonStaff = [];
      for (const player in players) {
        const playerData = players[player];
        const rank = playerData.Permission;
        if (rank !== "Normal") {
          staff.push(playerData);
        } else {
          nonStaff.push(playerData);
        }
      }

      const embed = baseEmbed(CONSTANTS.EMBED_COLOR);
      const staffLinks = await Promise.all(
        staff.map(async (p) =>
          makeRobloxProfileLink(Number(p.Player.split(":")[1]), p.Team),
        ),
      );
      const nonStaffLinks = await Promise.all(
        nonStaff.map(async (p) =>
          makeRobloxProfileLink(Number(p.Player.split(":")[1]), p.Team),
        ),
      );
      embed.setTitle(`Server Players [${players.length}]`);
      embed.addFields({
        name: `Server Staff [${staff.length}]`,
        value: staffLinks.join(", ") || "> No players online.",
        inline: false,
      });
      embed.addFields({
        name: `Online Players [${nonStaff.length}]`,
        value: nonStaffLinks.join(", ") || "> No players online.",
        inline: false,
      });
      await ctx.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error(`Failed to fetch players: ${err}`);
      await logCommandError(ctx, "/erlc players", err).catch(() => {});
      const errorEmbed = createErrorEmbed(
        "Failed to fetch and show ERLC players",
        err instanceof Error ? err.message : "An unknown error occured.",
      );
      if (ctx.deferred || ctx.replied) {
        await ctx.editReply({ embeds: [errorEmbed] });
      } else {
        await ctx.reply({
          embeds: [errorEmbed],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
} satisfies SubCommand;
