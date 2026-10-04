import { Client, SlashCommandBuilder } from "discord.js";
import { logger } from "../utils/logger.js";
import { CommandLoader } from "../loaders/unifiedCommandLoader.js";
import { startSyncScheduler } from "../jobs/syncScheduler.js";
import { startErlcCommandWatcher } from "../jobs/erlcCommandWatcher.js";

export async function onReady(
  client: Client<true>,
  slashData: SlashCommandBuilder[],
) {
  logger.success(`✅ Logged in as ${client.user.tag}`);
  logger.info(`📊 Serving ${client.guilds.cache.size} guilds`);

  // Clear any leftover global commands so they don't show up twice next to
  // the per-guild ones.
  await client.application.commands
    .set([])
    .catch((error) => logger.error("Failed to clear global commands:", error));
  await CommandLoader.registerSlashCommands(client.guilds.cache.values(), slashData);

  startSyncScheduler(client);
  startErlcCommandWatcher(client);
}
