import { readdirSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { Guild, SlashCommandBuilder } from "discord.js";
import { UnifiedCommand } from "../types/UnifiedCommand.js";
import { buildSlashCommandData } from "../utils/defineCommand.js";
import { logger } from "../utils/logger.js";

export interface LoadedCommands {
  /** Keyed by canonical command name — used for both `!name` and `/name`. */
  byName: Map<string, UnifiedCommand>;
  /** Keyed by alias — prefix-only, since slash commands don't support aliases. */
  byAlias: Map<string, UnifiedCommand>;
  /** Slash command builders, ready to hand to registerSlashCommands. */
  slashData: SlashCommandBuilder[];
}

export class CommandLoader {
  /**
   * Walks src/commands/<category>/*.ts, loading each file's default export as a
   * single UnifiedCommand and deriving both the prefix and slash registrations
   * from it. One file = one command, registered as both.
   */
  static async loadCommands(baseDir: string): Promise<LoadedCommands> {
    const byName = new Map<string, UnifiedCommand>();
    const byAlias = new Map<string, UnifiedCommand>();
    const slashData: SlashCommandBuilder[] = [];

    try {
      const categories = readdirSync(baseDir);

      for (const category of categories) {
        const categoryPath = resolve(baseDir, category);
        const files = readdirSync(categoryPath).filter(
          (file) =>
            (file.endsWith(".js") || file.endsWith(".ts")) &&
            !file.endsWith(".d.ts"),
        );

        // If this folder has an index file, it defines a parent command whose
        // subcommands are the other files in the folder (imported directly by
        // index.ts, e.g. `subcommands: [setup, configuration]`). Only the index
        // file gets registered as a top-level command — the rest are subcommand
        // sources, not standalone commands, and must not be loaded on their own
        // or they'd end up registered twice (once nested, once standalone).
        const indexFile = files.find((file) => /^index\.(js|ts)$/.test(file));

        const filesToLoad = indexFile ? [indexFile] : files;

        for (const file of filesToLoad) {
          const filePath = resolve(categoryPath, file);

          try {
            const fileUrl = pathToFileURL(filePath).href;
            const module = await import(fileUrl);
            const command: UnifiedCommand =
              module.default || Object.values(module)[0];

            if (
              !command ||
              !command.name ||
              (!command.execute && !command.subcommands)
            ) {
              logger.warn(`Skipped invalid command in ${filePath}`);
              continue;
            }

            if (byName.has(command.name)) {
              logger.warn(
                `Duplicate command name "${command.name}" in ${filePath}, skipping`,
              );
              continue;
            }

            byName.set(command.name, command);

            for (const alias of command.aliases ?? []) {
              byAlias.set(alias, command);
            }

            slashData.push(buildSlashCommandData(command));

            const subcommandNote = command.subcommands
              ? ` with subcommands: ${command.subcommands.map((s) => s.name).join(", ")}`
              : "";
            logger.info(
              `✅ Loaded command: ${command.name} (prefix + slash)${subcommandNote}`,
            );
          } catch (error) {
            logger.error(`Failed to load command from ${filePath}:`, error);
          }
        }
      }

      logger.success(`Loaded ${byName.size} commands`);
      return { byName, byAlias, slashData };
    } catch (error) {
      logger.error("Failed to load commands:", error);
      return { byName, byAlias, slashData };
    }
  }

  /**
   * Registers the slash commands per guild (instant, unlike global commands'
   * propagation delay) for every guild given. One failing guild doesn't stop
   * the rest.
   */
  static async registerSlashCommands(
    guilds: Iterable<Guild>,
    slashData: SlashCommandBuilder[],
  ) {
    const commandData = slashData.map((builder) => builder.toJSON());

    for (const guild of guilds) {
      try {
        await guild.commands.set(commandData);
        logger.info(
          `Registered ${commandData.length} commands to guild ${guild.name} (${guild.id})`,
        );
      } catch (error) {
        logger.error(`Failed to register slash commands in ${guild.id}:`, error);
      }
    }
  }
}
