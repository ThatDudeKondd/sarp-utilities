import { GuildMember, Message } from "discord.js";
import { logger } from "../utils/logger.js";
import { baseEmbed } from "../utils/formatters.js";
import { CONSTANTS } from "../config/constants.js";

const AFK_PREFIX = "[AFK] ";

interface AfkEntry {
  message: string;
  since: number;
  guildId?: string;
  /** Nickname before going AFK (null = none), restored on return. */
  nickname: string | null;
}

// In-memory on purpose: AFK is a short-lived status, and losing it on a bot
// restart just means the user isn't flagged AFK anymore.
// ponytail: a restart mid-AFK leaves the "[AFK] " nickname behind; persist entries if that bites.
const afkUsers = new Map<string, AfkEntry>();

export async function setAfk(
  userId: string,
  message: string,
  member: GuildMember | null,
): Promise<void> {
  afkUsers.set(userId, {
    message,
    since: Date.now(),
    guildId: member?.guild.id,
    nickname: member?.nickname ?? null,
  });

  if (member && !member.displayName.startsWith(AFK_PREFIX)) {
    // Fails for the server owner or members above the bot; AFK still applies.
    await member
      .setNickname(`${AFK_PREFIX}${member.displayName}`.slice(0, 32), "AFK")
      .catch(() => {});
  }
}

async function restoreNickname(message: Message, entry: AfkEntry): Promise<void> {
  if (!entry.guildId) return;
  const member = await message.client.guilds.cache
    .get(entry.guildId)
    ?.members.fetch(message.author.id)
    .catch(() => null);
  // Only undo our own prefix; leave it if they've renamed themselves since.
  if (member?.nickname?.startsWith(AFK_PREFIX)) {
    await member.setNickname(entry.nickname, "Back from AFK").catch(() => {});
  }
}

/**
 * Runs on every non-bot message: clears the author's AFK status if set, and
 * tells the channel when the message mentions someone who is AFK.
 */
export async function handleAfkMessage(message: Message): Promise<void> {
  if (message.author.bot || !message.channel.isSendable()) return;

  try {
    const own = afkUsers.get(message.author.id);
    if (own) {
      afkUsers.delete(message.author.id);
      await restoreNickname(message, own);
      await message.reply({
        embeds: [
          baseEmbed(CONSTANTS.EMBED_SUCCESS_COLOR).setDescription(
            "👋 Welcome back, your AFK status has been removed.",
          ),
        ],
        allowedMentions: { repliedUser: false },
      });
    }

    const notices = [...message.mentions.users.values()]
      .filter((user) => user.id !== message.author.id)
      .flatMap((user) => {
        const entry = afkUsers.get(user.id);
        if (!entry) return [];
        const since = Math.floor(entry.since / 1000);
        return [`💤 <@${user.id}> is currently AFK for: **${entry.message}** (<t:${since}:R>)`];
      });

    if (notices.length) {
      await message.reply({
        embeds: [
          baseEmbed(CONSTANTS.EMBED_WARNING_COLOR).setDescription(notices.join("\n")),
        ],
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    logger.error("Failed to handle AFK message:", error);
  }
}
