import { Message, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { logger } from "../utils/logger.js";
import { checkCommandCooldown } from "../middleware/cooldown.js";
import {
  logCommandExecution,
  logCommandError,
} from "../middleware/commandLogger.js";
import { GuildConfigService } from "./GuildConfigService.js";
import { UnifiedCommand, SubCommand } from "../types/UnifiedCommand.js";
import { CommandContext } from "../utils/commandContext.js";
import { asEmbed } from "../utils/formatters.js";

export class CommandHandler {
  /**
   * Handle prefix commands from messages
   */
  static async handlePrefixCommand(
    message: Message,
    commands: Map<string, UnifiedCommand>,
    aliases: Map<string, UnifiedCommand>,
  ): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    const guildConfig = await GuildConfigService.getConfig(
      message.guild?.id ?? "",
    );

    // Get guild config for custom prefix
    let prefix: string = guildConfig?.prefix as string;
    if (message.guild) {
      try {
        prefix = await GuildConfigService.getPrefix(message.guild.id);
      } catch (error) {
        logger.warn(
          `Failed to get prefix for guild ${message.guild.id}, using default`,
        );
      }
    }

    // Check if message starts with prefix
    if (!message.content.startsWith(prefix)) return;

    // Parse command and arguments
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();

    if (!commandName) return;

    const command = commands.get(commandName) ?? aliases.get(commandName);

    if (!command) return;

    if (!(await this.passesChecks(message, command))) return;

    // Handle prefix subcommands
    if (command.subcommands && args.length > 0) {
      const subcommandName = args.shift()?.toLowerCase();

      const subcommand = command.subcommands.find(
        (sub) =>
          sub.name === subcommandName || sub.aliases?.includes(subcommandName!),
      );

      if (subcommand) {
        const ctx = new CommandContext(message, subcommand.options, args);

        await this.executeCommand(
          ctx,
          subcommand,
          `${prefix}${command.name} ${subcommand.name}`,
          message.author.tag,
        );

        return;
      }
    }

    // Normal non-subcommand command
    if (!command.execute) return;

    const ctx = new CommandContext(message, command.options, args);

    await this.executeCommand(
      ctx,
      command,
      `${prefix}${command.name}`,
      message.author.tag,
    );
  }

  /**
   * Handle slash commands from interactions
   */
  static async handleSlashCommand(
    interaction: ChatInputCommandInteraction,
    commands: Map<string, UnifiedCommand>,
  ): Promise<void> {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);

    if (!command) {
      logger.warn(`Slash command not found: ${interaction.commandName}`);
      await interaction
        .reply(asEmbed({ content: "❌ This command is not available", ephemeral: true }))
        .catch(() => {});
      return;
    }

    if (!(await this.passesChecks(interaction, command))) return;

    const subcommandName = interaction.options.getSubcommand(false);

    if (subcommandName && command.subcommands) {
      const subcommand = command.subcommands.find(
        (sub) => sub.name === subcommandName,
      );

      if (!subcommand) {
        await interaction.reply(
          asEmbed({ content: "❌ Unknown subcommand.", ephemeral: true }),
        );
        return;
      }

      const ctx = new CommandContext(interaction, subcommand.options);

      await this.executeCommand(
        ctx,
        subcommand,
        `/${command.name} ${subcommand.name}`,
        interaction.user.tag,
      );

      return;
    }

    const ctx = new CommandContext(interaction);

    await this.executeCommand(
      ctx,
      command,
      `/${command.name}`,
      interaction.user.tag,
    );
  }

  /**
   * Shared guildOnly / permission / cooldown gating for both invocation types.
   * Sends the appropriate rejection reply itself and returns false if the
   * command should not run.
   */
  private static async passesChecks(
    source: Message | ChatInputCommandInteraction,
    command: UnifiedCommand,
  ): Promise<boolean> {
    const isMessage = source instanceof Message;
    const guild = isMessage ? source.guild : source.guild;
    const userId = isMessage ? source.author.id : source.user.id;

    const reject = async (content: string) => {
      if (isMessage) {
        await source.reply(asEmbed({ content })).catch(() => {});
      } else {
        await source.reply(asEmbed({ content, ephemeral: true })).catch(() => {});
      }
    };

    if (command.guildOnly && !guild) {
      await reject("❌ This command can only be used in a server.");
      return false;
    }

    if (command.permissions?.length) {
      const memberPermissions = isMessage
        ? source.member?.permissions
        : source.memberPermissions;
      if (!memberPermissions || !memberPermissions.has(command.permissions)) {
        await reject("❌ You do not have permission to use this command.");
        return false;
      }
    }

    const cooldownMs = command.cooldown ?? 3000;
    const canExecute = await checkCommandCooldown(
      userId,
      command.name,
      cooldownMs,
      (seconds) =>
        reject(
          `⏱️ Please wait ${seconds}s before using \`${command.name}\` again.`,
        ),
    );

    return canExecute;
  }

  /**
   * Unified command execution -- logging (console + guild logs channel) and
   * error handling, shared by every entry point: top-level and subcommand,
   * prefix and slash alike. This is the single choke point every command
   * execution passes through, which is what makes logCommandExecution a
   * complete audit trail rather than something that has to be remembered
   * per command.
   */
  private static async executeCommand(
    ctx: CommandContext,
    command: UnifiedCommand | SubCommand,
    commandDisplay: string,
    userTag: string,
  ): Promise<void> {
    try {
      logger.info(`⚡ Executing command: ${commandDisplay} by ${userTag}`);

      // Fire-and-forget: logging to the guild's channel is an audit trail,
      // not something the user should have to wait on. Awaiting this
      // added a real DB lookup + Discord API round trip in front of every
      // single command's actual execution -- felt as lag on everything,
      // not just whatever the log message itself was slow to send.
      logCommandExecution(ctx, commandDisplay).catch((err) =>
        logger.error("Failed to log command execution:", err),
      );

      await command.execute?.(ctx);
    } catch (error) {
      logger.error(`Error executing command ${command.name}:`, error);

      // Same reasoning: don't make the user's error reply wait on the
      // log send either.
      logCommandError(ctx, commandDisplay, error).catch((err) =>
        logger.error("Failed to log command error:", err),
      );

      await ctx
        .reply({
          content: "❌ An error occurred while executing the command",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }
}