import {
  Message,
  ChatInputCommandInteraction,
  User,
  GuildMember,
  Guild,
  TextBasedChannel,
  Role,
  Client,
  MessageFlags,
  UserManager,
  MessageMentionOptions,
} from "discord.js";
import { CommandOption } from "../types/UnifiedCommand.js";
import { asEmbed } from "./formatters.js";

export interface ReplyOptions {
  content?: string;
  embeds?: any[];
  components?: any[];
  files?: any[];
  flags?: number | bigint;
  allowedMentions?: MessageMentionOptions;
}

type ResolvedValue = string | number | boolean | User | TextBasedChannel | Role;

/**
 * Wraps either a prefix `Message` or a slash `ChatInputCommandInteraction` so
 * a single `execute(ctx)` function can handle both without branching.
 */
export class CommandContext {
  public message?: Message;
  private readonly _interaction?: ChatInputCommandInteraction;
  private readonly resolvedArgs = new Map<string, ResolvedValue>();
  private lastReply?: Message;

  public readonly isPrefix: boolean;
  public readonly isSlash: boolean;
  /** Raw whitespace-split args — only populated for prefix invocations. */
  public readonly args: string[];

  constructor(
    source: Message | ChatInputCommandInteraction,
    options: CommandOption[] = [],
    args: string[] = [],
  ) {
    if (source instanceof Message) {
      this.message = source;
      this.isPrefix = true;
      this.isSlash = false;
      this.args = args;
      this.resolvePrefixArgs(options, args);
    } else {
      this._interaction = source;
      this.isPrefix = false;
      this.isSlash = true;
      this.args = [];
    }
  }

  get client(): Client {
    return (this.message?.client ?? this._interaction!.client) as Client;
  }

  get user(): User {
    return this.isSlash ? this._interaction!.user : this.message!.author;
  }

  get member(): GuildMember | null {
    const member = this.isSlash
      ? this._interaction!.member
      : this.message!.member;
    return (member as GuildMember) ?? null;
  }

  get guild(): Guild | null {
    return this.isSlash ? this._interaction!.guild : this.message!.guild;
  }

  get subcommand(): string | null {
    if (this.isSlash) {
      return this._interaction!.options.getSubcommand(false);
    }

    return this.args[0] ?? null;
  }

  get channel(): TextBasedChannel | null {
    return this.isSlash ? this._interaction!.channel : this.message!.channel;
  }

  get users(): UserManager | null {
    return this.isSlash ? this._interaction!.client.users : this.client.users;
  }

  /** The underlying Message or Interaction, for anything not covered by this wrapper. */
  get raw(): Message | ChatInputCommandInteraction {
    return (this.message ?? this._interaction)!;
  }

  /**
   * Resolves the invoking message's channel to something send()-able,
   * narrowing away the union members (e.g. PartialGroupDMChannel) that
   * lack a send method or have inconsistent return types.
   */
  private getSendableChannel() {
    const channel = this.message!.channel;

    if (!channel.isSendable()) {
      throw new Error("Cannot send messages in this channel.");
    }

    return channel;
  }

  async reply(content: string | ReplyOptions): Promise<unknown> {
    const payload = asEmbed(typeof content === "string" ? { content } : content);

    if (this.isSlash) {
      const interaction = this._interaction!;

      if (interaction.deferred || interaction.replied) {
        return interaction.followUp(payload as any);
      }

      return interaction.reply(payload as any);
    }

    // Prefix commands cannot use Discord interaction flags
    const { flags, ...messagePayload } = payload;

    this.lastReply = await this.getSendableChannel().send(
      messagePayload as any,
    );

    return this.lastReply;
  }

  async editReply(options: ReplyOptions): Promise<Message> {
    const content = asEmbed(options);
    if (this.isSlash) {
      const interaction = this._interaction!;

      if (!interaction.deferred && !interaction.replied) {
        throw new Error(
          "Cannot edit an interaction before replying or deferring.",
        );
      }

      return (await interaction.editReply(content as any)) as Message;
    }

    const { flags, ...messagePayload } = content;

    if (!this.lastReply) {
      this.lastReply = await this.getSendableChannel().send(
        messagePayload as any,
      );
      return this.lastReply;
    }

    await this.lastReply.edit(messagePayload as any);

    return this.lastReply;
  }

  async fetchReply(): Promise<Message> {
    if (this.isSlash) {
      return (await this._interaction!.fetchReply()) as Message;
    }

    if (!this.lastReply) {
      throw new Error("No reply has been sent yet.");
    }

    return this.lastReply;
  }

  /** Defers the reply. No-op for prefix commands, which have no such concept. */
  async defer(ephemeral = false): Promise<void> {
    if (
      this.isSlash &&
      !this._interaction!.deferred &&
      !this._interaction!.replied
    ) {
      await this._interaction!.deferReply({
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
    }
  }

  get interaction(): ChatInputCommandInteraction | undefined {
    return this._interaction;
  }

  get deferred(): boolean {
    return this._interaction?.deferred ?? false;
  }

  get replied(): boolean {
    return this._interaction?.replied ?? false;
  }

  getString(name: string): string | null {
    if (this.isSlash) return this._interaction!.options.getString(name);
    const value = this.resolvedArgs.get(name);
    return typeof value === "string" ? value : null;
  }

  getInteger(name: string): number | null {
    if (this.isSlash) return this._interaction!.options.getInteger(name);
    const value = this.resolvedArgs.get(name);
    return typeof value === "number" ? value : null;
  }

  getNumber(name: string): number | null {
    if (this.isSlash) return this._interaction!.options.getNumber(name);
    const value = this.resolvedArgs.get(name);
    return typeof value === "number" ? value : null;
  }

  getBoolean(name: string): boolean | null {
    if (this.isSlash) return this._interaction!.options.getBoolean(name);
    const value = this.resolvedArgs.get(name);
    return typeof value === "boolean" ? value : null;
  }

  getUser(name: string): User | null {
    if (this.isSlash) return this._interaction!.options.getUser(name);
    return (this.resolvedArgs.get(name) as User) ?? null;
  }

  getChannel(name: string): TextBasedChannel | null {
    if (this.isSlash)
      return this._interaction!.options.getChannel(
        name,
      ) as TextBasedChannel | null;
    return (this.resolvedArgs.get(name) as TextBasedChannel) ?? null;
  }

  getRole(name: string): Role | null {
    if (this.isSlash)
      return this._interaction!.options.getRole(name) as Role | null;
    return (this.resolvedArgs.get(name) as Role) ?? null;
  }

  /**
   * Positionally maps raw prefix args onto the command's declared options, converting
   * each token according to its option type. A trailing "string" option consumes all
   * remaining tokens (handy for things like a `reason` field).
   */
  private resolvePrefixArgs(options: CommandOption[], args: string[]) {
    const tokens = [...args];

    options.forEach((option, index) => {
      const isLastOption = index === options.length - 1;
      const raw =
        option.type === "string" && isLastOption
          ? tokens.splice(0).join(" ") || undefined
          : tokens.shift();

      if (raw === undefined || raw === "") return;

      switch (option.type) {
        case "string":
          this.resolvedArgs.set(option.name, raw);
          break;
        case "integer": {
          const value = parseInt(raw, 10);
          if (!Number.isNaN(value)) this.resolvedArgs.set(option.name, value);
          break;
        }
        case "number": {
          const value = parseFloat(raw);
          if (!Number.isNaN(value)) this.resolvedArgs.set(option.name, value);
          break;
        }
        case "boolean":
          this.resolvedArgs.set(
            option.name,
            ["true", "yes", "1"].includes(raw.toLowerCase()),
          );
          break;
        case "user": {
          const id = raw.replace(/[<@!>]/g, "");
          const user =
            this.message?.mentions.users.get(id) ??
            this.message?.client.users.cache.get(id);
          if (user) this.resolvedArgs.set(option.name, user);
          break;
        }
        case "channel": {
          const id = raw.replace(/[<#>]/g, "");
          const channel =
            this.message?.mentions.channels.get(id) ??
            this.message?.guild?.channels.cache.get(id);
          if (channel)
            this.resolvedArgs.set(option.name, channel as TextBasedChannel);
          break;
        }
        case "role": {
          const id = raw.replace(/[<@&>]/g, "");
          const role =
            this.message?.mentions.roles.get(id) ??
            this.message?.guild?.roles.cache.get(id);
          if (role) this.resolvedArgs.set(option.name, role);
          break;
        }
        default:
          this.resolvedArgs.set(option.name, raw);
      }
    });
  }
}
