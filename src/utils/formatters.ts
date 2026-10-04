import { EmbedBuilder, APIEmbedField, User } from "discord.js";
import { CONSTANTS } from "../config/constants.js";

/**
 * Shared base for every embed: consistent color handling, timestamp, and
 * footer branding, so individual builders below only set what's unique
 * to them.
 */
export function baseEmbed(color: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: CONSTANTS.EMBED_FOOTER_TEXT });
}

/**
 * Every bot reply is an embed: turns a plain-text payload into one (red when it
 * starts with ❌). Payloads that already carry embeds pass through untouched.
 */
export function asEmbed<T extends { content?: string; embeds?: unknown[] }>(
  payload: T,
): T {
  if (!payload.content || payload.embeds?.length) return payload;
  const color = payload.content.startsWith("❌")
    ? CONSTANTS.EMBED_ERROR_COLOR
    : CONSTANTS.EMBED_COLOR;
  return {
    ...payload,
    content: "",
    embeds: [baseEmbed(color).setDescription(payload.content)],
  };
}

export function createSuccessEmbed(
  title: string,
  description: string,
): EmbedBuilder {
  return baseEmbed(CONSTANTS.EMBED_SUCCESS_COLOR)
    .setTitle(`✅  ${title}`)
    .setDescription(description);
}

export function createErrorEmbed(
  title: string,
  description: string,
): EmbedBuilder {
  return baseEmbed(CONSTANTS.EMBED_ERROR_COLOR)
    .setTitle(`❌  ${title}`)
    .setDescription(description);
}

export function createWarningEmbed(
  title: string,
  description: string,
): EmbedBuilder {
  return baseEmbed(CONSTANTS.EMBED_WARNING_COLOR)
    .setTitle(`⚠️  ${title}`)
    .setDescription(description);
}

export function createInfoEmbed(
  title: string,
  description: string,
  fields: APIEmbedField[] = [],
): EmbedBuilder {
  const embed = baseEmbed(CONSTANTS.EMBED_COLOR)
    .setTitle(`ℹ️  ${title}`)
    .setDescription(description);

  if (fields.length > 0) {
    embed.addFields(fields.slice(0, CONSTANTS.MAX_EMBED_FIELDS));
  }

  return embed;
}

export interface InfractionEmbedOptions {
  /** The user receiving the infraction. */
  infractee: User;
  /** The staff member issuing it. */
  moderator: User;
  punishment: string;
  reason: string;
  /** Optional case/ticket number, shown in the title when provided. */
  caseNumber?: number;
}

/**
 * Dedicated embed for `/infract` and anywhere else an infraction needs to
 * be displayed. Distinct color from the generic error embed so moderation
 * actions are visually recognizable at a glance in a busy log channel.
 */
export function createInfractionEmbed(
  options: InfractionEmbedOptions,
): EmbedBuilder {
  const { infractee, moderator, punishment, reason, caseNumber } = options;

  return baseEmbed(CONSTANTS.EMBED_INFRACTION_COLOR)
    .setAuthor({
      name: infractee.tag,
      iconURL: infractee.displayAvatarURL(),
    })
    .setTitle(
      caseNumber !== undefined
        ? `Infraction Issued — Case #${caseNumber}`
        : "Infraction Issued",
    )
    .setThumbnail(infractee.displayAvatarURL({ size: 256 }))
    .addFields(
      {
        name: "User",
        value: `${infractee} (\`${infractee.id}\`)`,
        inline: false,
      },
      { name: "Punishment", value: punishment, inline: false },
      { name: "Reason", value: truncateString(reason) },
    )
    .setFooter({
      text: `Signed by ${moderator.tag}`,
      iconURL: moderator.displayAvatarURL(),
    });
}

export function truncateString(
  str: string,
  maxLength: number = CONSTANTS.MAX_FIELD_LENGTH,
): string {
  if (str.length > maxLength) {
    return str.slice(0, maxLength - 3) + "...";
  }
  return str;
}

export function isPartialMatch(input: string, target: string): boolean {
  return target.toLowerCase().startsWith(input.toLowerCase());
}

export function formatFieldsFromObject(
  obj: Record<string, unknown>,
  customFormatters: Record<string, (value: unknown) => string> = {},
): APIEmbedField[] {
  const fields: APIEmbedField[] = [];

  for (const [key, value] of Object.entries(obj)) {
    let str: string;

    if (customFormatters[key]) {
      str = customFormatters[key](value);
    } else if (value === null || value === undefined) {
      str = "—";
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      str = String(value);
    } else {
      str = JSON.stringify(value);
    }

    str = truncateString(str);
    fields.push({ name: `${key}:`, value: str, inline: true });

    if (fields.length >= CONSTANTS.MAX_EMBED_FIELDS) break;
  }

  return fields;
}
