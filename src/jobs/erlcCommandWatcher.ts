import { Client, EmbedBuilder } from "discord.js";
import { config } from "../config/config.js";
import { CONSTANTS } from "../config/constants.js";
import { logger } from "../utils/logger.js";
import { prisma } from "../database/client.js";

const POLL_INTERVAL_MS = 10_000;
// POST /command is limited to 1 request per 5s per server (per the API docs).
const COMMAND_SPACING_MS = 5_500;

/** Commands that are dangerous when aimed at everyone (e.g. `:ban all`). */
const DANGEROUS_COMMANDS = new Set([
  "ban", "unban", "pban", "tban", "kick",
  "mod", "unmod", "admin", "unadmin", "helper", "unhelper",
]);
const MASS_TARGETS = new Set(["all", "others"]);

export interface CommandLogEntry {
  Player: string; // "Name:RobloxId"
  Timestamp: number; // unix seconds
  Command: string; // ":ban all reason"
}

/**
 * Returns the offender's Roblox ID when `entry` is a dangerous command aimed
 * at everyone (`:ban all`, `:unmod others`, ...), otherwise null.
 */
export function massCommandOffender(entry: CommandLogEntry): string | null {
  const [name, target] = entry.Command.trim().replace(/^[:;]/, "").split(/\s+/);
  if (!DANGEROUS_COMMANDS.has(name?.toLowerCase()) || !MASS_TARGETS.has(target?.toLowerCase()))
    return null;
  const id = entry.Player.slice(entry.Player.lastIndexOf(":") + 1);
  return /^\d+$/.test(id) ? id : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits out a 429 or an exhausted bucket, as the API requires (repeat violations get IP-blocked). */
async function respectRateLimit(res: Response): Promise<void> {
  if (res.status === 429) {
    await sleep((Number(res.headers.get("retry-after")) || 5) * 1000);
  } else if (res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    if (reset > Date.now()) await sleep(Math.min(reset - Date.now(), 60_000));
  }
}

async function runErlcCommand(command: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${config.erlcApiBaseUrl}/command`, {
      ...config.postOptions,
      body: JSON.stringify({ command }),
    });
    if (res.status !== 429) {
      await respectRateLimit(res);
      return res.ok ? "ok" : `failed (${res.status})`;
    }
    await respectRateLimit(res);
  }
  return "failed (rate limited)";
}

/**
 * Posts to every server's ER:LC log channel (set via `-server config`). With
 * `pingSupervisors`, also pings that server's supervisor roles.
 */
async function sendToAlertChannel(
  client: Client,
  embed: EmbedBuilder,
  pingSupervisors = false,
): Promise<void> {
  const configs = await prisma.guildConfig.findMany({
    where: { erlcLogChannel: { not: "" } },
    select: { erlcLogChannel: true, supervisorRoles: true },
  });
  for (const { erlcLogChannel, supervisorRoles } of configs) {
    const channel = await client.channels.fetch(erlcLogChannel!).catch(() => null);
    if (!channel?.isSendable()) continue;
    const roles = pingSupervisors ? supervisorRoles : [];
    await channel
      .send({
        content: roles.map((id) => `<@&${id}>`).join(" ") || undefined,
        embeds: [embed],
        allowedMentions: { roles },
      })
      .catch(() => {});
  }
}

async function punish(client: Client, entry: CommandLogEntry, robloxId: string) {
  logger.warn(`ER:LC mass command by ${entry.Player}: ${entry.Command} -- stripping perms`);
  const results: string[] = [];
  for (const cmd of [`:unmod ${robloxId}`, `:unadmin ${robloxId}`]) {
    results.push(`\`${cmd}\`: ${await runErlcCommand(cmd)}`);
    await sleep(COMMAND_SPACING_MS);
  }
  await sendToAlertChannel(
    client,
    new EmbedBuilder()
      .setColor(CONSTANTS.EMBED_ERROR_COLOR)
      .setTitle("🚨 Mass command detected")
      .setDescription(
        `**${entry.Player.split(":")[0]}** ([${robloxId}](https://www.roblox.com/users/${robloxId}/profile)) ran \`${entry.Command}\` <t:${entry.Timestamp}:R>.\n\n${results.join("\n")}`,
      )
      .setTimestamp(),
    true,
  );
}

/**
 * Polls the ER:LC command log, posts new commands to each server's ER:LC log channel and
 * strips mod/admin from anyone who runs a dangerous command on everyone.
 * ER:LC has no push for `:` commands, so polling is the only option.
 */
export function startErlcCommandWatcher(client: Client<true>): void {
  if (!process.env.ERLC_API_KEY) {
    logger.warn("ERLC_API_KEY not set -- ER:LC command watcher disabled.");
    return;
  }
  // Only act on commands from now on, so a restart never re-punishes old ones.
  let lastSeen = Math.floor(Date.now() / 1000);
  const seenAtLastSecond = new Set<string>();

  const poll = async () => {
    try {
      const res = await fetch(`${config.erlcApiBaseUrl}?CommandLogs=true`, config.getOptions);
      if (!res.ok) {
        if (res.status !== 422) logger.warn(`ER:LC command log poll failed: ${res.status}`);
        await respectRateLimit(res);
        return;
      }
      await respectRateLimit(res);
      const { CommandLogs = [] } = (await res.json()) as { CommandLogs?: CommandLogEntry[] };

      const key = (e: CommandLogEntry) => `${e.Player}|${e.Command}`;
      const fresh = CommandLogs.filter(
        (e) => e.Timestamp > lastSeen || (e.Timestamp === lastSeen && !seenAtLastSecond.has(key(e))),
      ).sort((a, b) => a.Timestamp - b.Timestamp);
      if (!fresh.length) return;

      const newest = fresh[fresh.length - 1].Timestamp;
      if (newest > lastSeen) seenAtLastSecond.clear();
      lastSeen = newest;
      for (const e of fresh) if (e.Timestamp === newest) seenAtLastSecond.add(key(e));

      await sendToAlertChannel(
        client,
        new EmbedBuilder()
          .setColor(CONSTANTS.EMBED_COLOR)
          .setTitle("ER:LC commands")
          .setDescription(
            fresh
              .map((e) => `<t:${e.Timestamp}:T> **${e.Player.split(":")[0]}** \`${e.Command.slice(0, 200)}\``)
              .join("\n")
              .slice(0, 4000),
          ),
      );

      for (const e of fresh) {
        const offender = massCommandOffender(e);
        if (offender) await punish(client, e, offender);
      }
    } catch (error) {
      logger.error("ER:LC command watcher error:", error);
    }
  };

  // Chained timeouts, not setInterval: a slow poll (punishing, rate-limit
  // waits) must finish before the next one starts.
  const loop = async () => {
    await poll();
    setTimeout(loop, POLL_INTERVAL_MS);
  };
  void loop();
  logger.info(`🕵️ ER:LC command watcher polling every ${POLL_INTERVAL_MS / 1000}s`);
}
