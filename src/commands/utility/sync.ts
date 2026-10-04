import { EmbedBuilder, MessageFlags } from "discord.js";
import { defineCommand } from "../../utils/defineCommand.js";
import { CONSTANTS } from "../../config/constants.js";
import { syncGuildMembers } from "../../services/SyncService.js";
import { sendToLogsChannel } from "../../utils/logChannel.js";
import { GuildConfigService } from "../../services/GuildConfigService.js";
import { createErrorEmbed } from "../../utils/formatters.js";

const UPDATE_INTERVAL = 10;

export default defineCommand({
  name: "sync",
  description: "Syncronise the Database with current users and guild.",
  cooldown: 3000,
  execute: async (ctx) => {
    await ctx.defer();
    const guild = ctx.guild;
    if (!guild) return;

    // getConfig creates a default row when none exists, so this never
    // comes back empty -- an unconfigured guild just has no roles to match.
    const guildConfig = await GuildConfigService.getConfig(guild.id);

    const canRunRoles = [
      ...(guildConfig.directiveRoles || []),
      ...(guildConfig.seniorHrRoles || []),
    ];

    const hasRunPerms = ctx.member?.roles?.cache.some((role) =>
      canRunRoles.includes(role.id),
    );

    if (!hasRunPerms) {
      const embed = createErrorEmbed(
        "You do not have permission to run this command.",
        "This command is restricted to Senior Management and above.",
      );

      await ctx.editReply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const progressEmbed = (synced: number, failed: number, total: number) =>
      new EmbedBuilder()
        .setTitle("🔄 Syncing members...")
        .setDescription(
          `Progress: **${synced + failed}/${total}**\n✅ Synced: ${synced}\n❌ Failed: ${failed}`,
        )
        .setColor(CONSTANTS.EMBED_COLOR)
        .setTimestamp();

    await ctx.editReply({ embeds: [progressEmbed(0, 0, 0)] });

    let lastUpdate = 0;
    const { synced, failed, total } = await syncGuildMembers(
      guild,
      async ({ synced, failed, total }) => {
        const processed = synced + failed;
        if (processed - lastUpdate >= UPDATE_INTERVAL || processed === total) {
          lastUpdate = processed;
          await ctx.editReply({
            embeds: [progressEmbed(synced, failed, total)],
          });
        }
      },
    );

    const resultEmbed =
      failed === 0
        ? new EmbedBuilder()
            .setTitle("✅ Sync complete")
            .setDescription(
              `Successfully synced **${synced}/${total}** members.`,
            )
            .setColor(CONSTANTS.EMBED_SUCCESS_COLOR)
            .setTimestamp()
        : new EmbedBuilder()
            .setTitle(
              synced === 0 ? "❌ Sync failed" : "⚠️ Sync completed with errors",
            )
            .setDescription(
              `✅ Synced: **${synced}/${total}**\n❌ Failed: **${failed}/${total}**\n\nCheck the logs for details on failed members.`,
            )
            .setColor(CONSTANTS.EMBED_ERROR_COLOR)
            .setTimestamp();

    resultEmbed.setFooter({ text: `Triggered by ${ctx.user.tag}` });

    await ctx.editReply({ embeds: [resultEmbed] });
    await sendToLogsChannel(guild, resultEmbed);
  },
});
