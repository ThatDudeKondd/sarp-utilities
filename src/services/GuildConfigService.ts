import { prisma } from "../database/client.js";
import { logger } from "../utils/logger.js";
import type { Prisma } from "../generated/prisma/client.js";

export class GuildConfigService {
  /**
   * Get or create guild config
   */
  static async getConfig(guildId: string) {
    try {
      let config = await prisma.guildConfig.findUnique({
        where: { guildId },
      });

      if (!config) {
        config = await prisma.guildConfig.create({
          data: { guildId },
        });
        logger.info(`Created new guild config for ${guildId}`);
      }

      return config;
    } catch (error) {
      logger.error(`Failed to get guild config for ${guildId}:`, error);
      throw error;
    }
  }

  /**
   * Update guild config
   *
   * `data` is intentionally loosely typed (Record of string | string[])
   * because callers like setup.ts and configuration.ts build this object
   * dynamically -- a channel step produces a string, a role step produces
   * a string[], and neither knows the others' exact field names at compile
   * time. Prisma's own generated types are much more precise per field
   * (e.g. `prefix` must be exactly `string`, `directiveRoles` must be
   * exactly `string[]`), which TypeScript can't reconcile against a single
   * blanket union type. The cast below is safe because every real caller
   * (getPrefix/setPrefix/setModLogChannel, and the generic callers in
   * setup.ts/configuration.ts) already puts the correct value shape on
   * the correct key -- there's no path that actually sends a string[]
   * where Prisma expects a string, or vice versa.
   */
  static async updateConfig(
    guildId: string,
    data: Partial<
      Record<
        | "prefix"
        | "modLogChannelId"
        | "infractionChannel"
        | "logsChannel"
        | "erlcLogChannel"
        | "directiveRoles"
        | "seniorHrRoles"
        | "managementRoles"
        | "supervisorRoles"
        | "administratorRoles"
        | "moderatorRoles",
        string | string[]
      >
    >,
  ) {
    try {
      const config = await prisma.guildConfig.upsert({
        where: { guildId },
        update: data as Prisma.GuildConfigUpdateInput,
        create: {
          guildId,
          ...data,
        } as Prisma.GuildConfigCreateInput,
      });

      logger.info(`Updated guild config for ${guildId}`);
      return config;
    } catch (error) {
      logger.error(`Failed to update guild config for ${guildId}:`, error);
      throw error;
    }
  }

  /**
   * Get guild prefix
   */
  static async getPrefix(guildId: string): Promise<string> {
    const config = await this.getConfig(guildId);
    return config.prefix;
  }

  /**
   * Set guild prefix
   */
  static async setPrefix(guildId: string, prefix: string) {
    return this.updateConfig(guildId, { prefix });
  }

  /**
   * Get mod log channel
   */
  static async getModLogChannel(guildId: string): Promise<string | null> {
    const config = await this.getConfig(guildId);
    return config.modLogChannelId;
  }

  /**
   * Set mod log channel
   */
  static async setModLogChannel(guildId: string, channelId: string) {
    return this.updateConfig(guildId, { modLogChannelId: channelId });
  }
}
