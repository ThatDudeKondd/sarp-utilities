import { prisma } from "../../database/client.js";
import { defineCommand } from "../../utils/defineCommand.js";
import { logger } from "../../utils/logger.js";
import {
  createErrorEmbed,
  createInfractionEmbed,
  createSuccessEmbed,
} from "../../utils/formatters.js";
import { GuildConfigService } from "../../services/GuildConfigService.js";
import { MessageFlags } from "discord.js";

export default defineCommand({
  name: "infract",
  description: "Infracts the given user with the punishment and reason.",
  cooldown: 1000,
  options: [
    {
      name: "user",
      description: "The user to be infracted.",
      type: "user",
      required: true,
    },
    {
      name: "punishment",
      description: "The punishment to be handed out.",
      type: "string",
      required: true,
    },
    {
      name: "reason",
      description: "The reason for the given infraction",
      type: "string",
      required: true,
    },
  ],

  execute: async (ctx) => {
    await ctx.defer();
    await ctx.message?.delete();

    const infractee = ctx.getUser("user");
    const punishment = ctx.getString("punishment");
    const reason = ctx.getString("reason");

    // Prefix invocations don't enforce `required` options, and a user arg only
    // resolves if it's a mention or a cached user -- so validate before any DB work.
    if (!infractee || !punishment || !reason) {
      const embed = createErrorEmbed(
        "Missing or invalid arguments.",
        "Usage: `-infract @user <punishment> <reason>` (the user must be @mentioned).",
      );

      await ctx.editReply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const guildData = await GuildConfigService.getConfig(ctx.guild?.id ?? "");

    const canRunRoles = [
      ...(guildData?.directiveRoles || []),
      ...(guildData?.seniorHrRoles || []),
      ...(guildData?.managementRoles || []),
      ...(guildData?.supervisorRoles || []),
    ];

    const hasRunPerms = ctx.member?.roles?.cache.some((role) =>
      canRunRoles.includes(role.id),
    );

    if (!hasRunPerms) {
      const embed = createErrorEmbed(
        "You do not have permission to run this command.",
        "This command is restricted to Supervisor+.",
      );

      await ctx.editReply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const infractionRecord = await prisma.infraction.create({
      data: {
        guildId: ctx.guild?.id ?? "",
        userId: infractee.id,
        moderatorId: ctx.user.id,
        punishment,
        reason,
      },
    });

    const infractionEmbed = createInfractionEmbed({
      infractee,
      moderator: ctx.user,
      punishment,
      reason,
      caseNumber: infractionRecord.caseNumber,
    });

    const infractionChannel = ctx.guild?.channels.cache.get(
      guildData?.infractionChannel || "",
    );

    if (infractionChannel?.isTextBased()) {
      await infractionChannel.send({
        content: `<@${infractee.id}>`,
        embeds: [infractionEmbed],
      });
    }

    const dmEmbed = infractionEmbed.setFooter({
      text: "This message was sent to you privately.",
      iconURL: infractee.displayAvatarURL(),
    });

    try {
      // User.send() opens a DM channel automatically -- no need to check
      // .dmChannel first, which only reflects what's already cached and
      // is usually undefined for a user the bot hasn't DMed before.
      await infractee.send({ embeds: [dmEmbed] });
    } catch (dmError) {
      // Most commonly the infractee has DMs closed -- log it, but don't
      // fail the whole command over a DM that was never guaranteed to work.
      logger.warn(
        `Could not DM infraction to ${infractee.tag} (${infractee.id}):`,
        dmError,
      );
    }

    const successEmbed = createSuccessEmbed(
      "Infraction Issued",
      `Successfully infracted user.`,
    );

    if (ctx.channel?.isSendable()) {
      const reply = await ctx.editReply({ embeds: [successEmbed] });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await reply.delete();
    }
  },
});
