import { CommandContext } from "../utils/commandContext.js";

export interface CommandOption {
  name: string;
  description: string;

  type:
    | "string"
    | "integer"
    | "number"
    | "boolean"
    | "user"
    | "channel"
    | "role"
    | "mentionable"
    | "attachment";

  required?: boolean;
  choices?: unknown[];
}

export interface SubCommand {
  name: string;
  description: string;

  aliases?: string[];

  options?: CommandOption[];

  execute: (ctx: CommandContext) => Promise<void>;
}

export interface UnifiedCommand {
  name: string;
  description: string;
  /** Folder under src/commands the command was loaded from; set by the loader. */
  category?: string;

  aliases?: string[];

  cooldown?: number;
  guildOnly?: boolean;

  permissions?: bigint[];

  options?: CommandOption[];

  subcommands?: SubCommand[];

  execute?: (ctx: CommandContext) => Promise<void>;
}
