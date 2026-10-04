import { Message } from "discord.js";
import { logger } from "../utils/logger.js";

interface AfkEntry {
  message: string;
  since: number;
}

// In-memory on purpose: AFK is a short-lived status, and losing it on a bot
// restart just means the user isn't flagged AFK anymore.
const afkUsers = new Map<string, AfkEntry>();

export function setAfk(userId: string, message: string): void {
  afkUsers.set(userId, { message, since: Date.now() });
}

/**
 * Runs on every non-bot message: clears the author's AFK status if set, and
 * tells the channel when the message mentions someone who is AFK.
 */
export async function handleAfkMessage(message: Message): Promise<void> {
  if (message.author.bot || !message.channel.isSendable()) return;

  try {
    if (afkUsers.delete(message.author.id)) {
      await message.reply({
        content: "👋 Welcome back, your AFK status has been removed.",
        allowedMentions: { repliedUser: false },
      });
    }

    const notices = [...message.mentions.users.values()]
      .filter((user) => user.id !== message.author.id)
      .flatMap((user) => {
        const entry = afkUsers.get(user.id);
        if (!entry) return [];
        const since = Math.floor(entry.since / 1000);
        return [`💤 **${user.username}** is AFK (<t:${since}:R>): ${entry.message}`];
      });

    if (notices.length) {
      await message.reply({
        content: notices.join("\n"),
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    logger.error("Failed to handle AFK message:", error);
  }
}
