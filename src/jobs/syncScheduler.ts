import { Client, EmbedBuilder } from "discord.js";
import { syncGuildMembers } from "../services/SyncService.js";
import { sendToLogsChannel } from "../utils/logChannel.js";
import { CONSTANTS } from "../config/constants.js";
import { logger } from "../utils/logger.js";

const DEFAULT_INTERVAL_MS = 1 * 60 * 60 * 1000; // every 6 hours

/**
 * Runs syncGuildMembers for every guild the bot is in, on a fixed interval.
 * Same logic as the manual /sync command, just without the interaction
 * context or progress embeds -- results go to the logger and, if the guild
 * has one configured, its logs channel.
 */
export function startSyncScheduler(
  client: Client<true>,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): void {
  const runSyncForAllGuilds = async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        const result = await syncGuildMembers(guild);
        logger.info(
          `🔄 Background sync for ${guild.name}: ${result.synced}/${result.total} synced, ${result.failed} failed`,
        );

        const embed = new EmbedBuilder()
          .setTitle(
            result.failed === 0
              ? "🔄 Background Sync Complete"
              : "⚠️ Background Sync Completed with Errors",
          )
          .setDescription(
            `✅ Synced: **${result.synced}/${result.total}**\n❌ Failed: **${result.failed}/${result.total}**`,
          )
          .setColor(
            result.failed === 0
              ? CONSTANTS.EMBED_SUCCESS_COLOR
              : CONSTANTS.EMBED_ERROR_COLOR,
          )
          .setFooter({ text: "Automatic background sync" })
          .setTimestamp();

        await sendToLogsChannel(guild, embed);
      } catch (error) {
        logger.error(`Background sync failed for guild ${guild.id}:`, error);
      }
    }
  };

  logger.info(
    `🕒 Background member sync scheduled every ${Math.round(intervalMs / 60000)} minutes`,
  );

  setInterval(runSyncForAllGuilds, intervalMs);
}
