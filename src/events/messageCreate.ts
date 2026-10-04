import { Message } from "discord.js";
import { CommandHandler } from "../services/CommandHandler.js";
import { handleAfkMessage } from "../services/AfkService.js";
import { UnifiedCommand } from "../types/UnifiedCommand.js";

export async function onMessageCreate(
  message: Message,
  commands: Map<string, UnifiedCommand>,
  aliases: Map<string, UnifiedCommand>,
) {
  // Before command handling, so `-afk` itself doesn't immediately clear the
  // status it's about to set.
  await handleAfkMessage(message);
  await CommandHandler.handlePrefixCommand(message, commands, aliases);
}
