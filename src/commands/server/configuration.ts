import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  PermissionsBitField,
  MessageFlags,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ButtonStyle,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
  type Message,
  type MessageComponentInteraction,
} from "discord.js";
import { CONSTANTS } from "../../config/constants.js";
import { prisma } from "../../database/client.js";
import type { GuildConfig } from "../../generated/prisma/client.js";
import { config } from "../../config/config.js";
import { logger } from "../../utils/logger.js";
import { asEmbed } from "../../utils/formatters.js";
import { SubCommand } from "../../types/UnifiedCommand.js";
import { GuildConfigService } from "../../services/GuildConfigService.js";
import { logCommandError } from "../../middleware/commandLogger.js";

type RoleCategoryKey =
  | "directiveRoles"
  | "seniorHrRoles"
  | "managementRoles"
  | "supervisorRoles"
  | "administratorRoles"
  | "moderatorRoles";

type ChannelCategoryKey =
  "infractionChannel" | "logsChannel" | "erlcLogChannel";

type ConfigCategoryKey = RoleCategoryKey | ChannelCategoryKey;

type ConfigCategory =
  | {
      type: "role";
      key: RoleCategoryKey;
      title: string;
      description: string;
    }
  | {
      type: "channel";
      key: ChannelCategoryKey;
      title: string;
      description: string;
      channelTypes?: ChannelType[];
    };

const CONFIG_CATEGORIES: ConfigCategory[] = [
  {
    type: "role",
    key: "directiveRoles",
    title: "Directive Roles",
    description: "Highest authority in the server.",
  },
  {
    type: "role",
    key: "seniorHrRoles",
    title: "Senior Management Roles",
    description: "Above Management level.",
  },
  {
    type: "role",
    key: "managementRoles",
    title: "Management Roles",
    description: "Above Supervisor level.",
  },
  {
    type: "role",
    key: "supervisorRoles",
    title: "Supervisor Roles",
    description: "Can execute /erlc run and higher-level actions.",
  },
  {
    type: "role",
    key: "administratorRoles",
    title: "Admin Roles",
    description: "Treated as server administration roles.",
  },
  {
    type: "role",
    key: "moderatorRoles",
    title: "Moderator Roles",
    description: "Can use moderator tools and /erlc players.",
  },
  {
    type: "channel",
    key: "infractionChannel",
    title: "Infraction Channel",
    description: "Channel used for sending infraction logs.",
    channelTypes: [ChannelType.GuildText],
  },
  {
    type: "channel",
    key: "logsChannel",
    title: "Logs Channel",
    description: "Channel used for general server activity and audit logs.",
    channelTypes: [ChannelType.GuildText],
  },
  {
    type: "channel",
    key: "erlcLogChannel",
    title: "ER:LC Log Channel",
    description: "Live in-game command log and mass-command alerts.",
    channelTypes: [ChannelType.GuildText],
  },
];

type Page = "roles" | "channels" | "misc";

const PAGES: Record<Page, { title: string; description: string }> = {
  roles: { title: "Roles", description: "Who counts as staff at each level." },
  channels: { title: "Channels", description: "Where the bot posts logs." },
  misc: { title: "Misc", description: "Other settings." },
};

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const button = (
  id: string,
  label: string,
  style = ButtonStyle.Secondary,
  disabled = false,
) =>
  new ButtonBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);

/** Bottom row on every view: page tabs (current one disabled) + Cancel. */
function navRow(current: Page | null) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(Object.keys(PAGES) as Page[]).map((page) =>
      button(
        `cfg_page_${page}`,
        PAGES[page].title,
        ButtonStyle.Primary,
        page === current,
      ),
    ),
    button("cfg_cancel", "Cancel", ButtonStyle.Danger),
  );
}

/** Splits buttons into rows of 5 (Discord's per-row limit). */
function rowsOf(buttons: ButtonBuilder[]) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        buttons.slice(i, i + 5),
      ),
    );
  }
  return rows;
}

function formatValue(
  category: ConfigCategory,
  guildConfig: GuildConfig,
): string {
  if (category.type === "role") {
    const roles = guildConfig[category.key];
    return roles.length
      ? roles.map((id) => `<@&${id}>`).join(", ")
      : "No roles assigned";
  }
  const channelId = guildConfig[category.key];
  return channelId ? `<#${channelId}>` : "Not set";
}

function pageView(page: Page, guildConfig: GuildConfig) {
  const embed = new EmbedBuilder()
    .setTitle(`Server Configuration — ${PAGES[page].title}`)
    .setDescription(PAGES[page].description)
    .setColor(CONSTANTS.EMBED_COLOR)
    .setTimestamp();

  let editButtons: ButtonBuilder[];
  if (page === "misc") {
    embed.addFields({
      name: "Command Prefix",
      value: `\`${guildConfig.prefix}\``,
    });
    editButtons = [button("cfg_edit_prefix", "Edit Command Prefix")];
  } else {
    const categories = CONFIG_CATEGORIES.filter(
      (c) => c.type === (page === "roles" ? "role" : "channel"),
    );
    embed.addFields(
      categories.map((c) => ({
        name: c.title,
        value: formatValue(c, guildConfig),
      })),
    );
    editButtons = categories.map((c) =>
      button(`cfg_edit_${c.key}`, `Edit ${c.title}`),
    );
  }

  return {
    embeds: [embed],
    components: [...rowsOf(editButtons), navRow(page)],
  };
}

function selectView(category: ConfigCategory, guildConfig: GuildConfig) {
  const isChannel = category.type === "channel";
  const embed = new EmbedBuilder()
    .setTitle(`Edit ${category.title}`)
    .setDescription(category.description)
    .addFields(
      { name: "Current", value: formatValue(category, guildConfig) },
      {
        name: "Instructions",
        value: isChannel
          ? "Choose a channel below. Submit without selecting to clear it."
          : "Choose one or more roles below. Submit without selecting to clear this category.",
      },
    )
    .setColor(CONSTANTS.EMBED_COLOR)
    .setTimestamp();

  const select = isChannel
    ? new ChannelSelectMenuBuilder()
        .setCustomId(`cfg_select_${category.key}`)
        .setPlaceholder(`Select a channel for ${category.title}`)
        .setChannelTypes(category.channelTypes ?? [ChannelType.GuildText])
        .setMinValues(0)
        .setMaxValues(1)
    : new RoleSelectMenuBuilder()
        .setCustomId(`cfg_select_${category.key}`)
        .setPlaceholder(`Select roles for ${category.title}`)
        .setMinValues(0)
        .setMaxValues(25);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<
        ChannelSelectMenuBuilder | RoleSelectMenuBuilder
      >().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("cfg_back", "Back"),
        button("cfg_cancel", "Cancel", ButtonStyle.Danger),
      ),
    ],
  };
}

function pageOf(category: ConfigCategory): Page {
  return category.type === "role" ? "roles" : "channels";
}

export default {
  name: "config",
  description: "View or edit the server's role-based access configuration.",
  aliases: ["configuration", "cfg"],
  execute: async (ctx) => {
    await ctx.defer();

    if (!ctx.guild) {
      throw new Error("This command can only be used in a server.");
    }

    const guildId = ctx.guild.id;

    const isSuperAdmin = ctx.user.id === config.superAdminId;
    const isAdmin = ctx.member?.permissions?.has(
      PermissionsBitField.Flags.Administrator,
    );
    if (!isSuperAdmin && !isAdmin) {
      throw new Error(
        "Only a server administrator or the super admin can run configuration.",
      );
    }

    try {
      let guildConfig = await prisma.guildConfig.findUnique({
        where: { guildId },
      });
      if (!guildConfig) {
        throw new Error(
          "This server has not been set up yet. Please run /server setup first.",
        );
      }

      let page: Page = "roles";
      const message: Message = await ctx.editReply(pageView(page, guildConfig));

      // One collector for the whole panel; every view is an in-place edit of
      // this message, so Back/Cancel never leave stray messages behind.
      const collector = message.createMessageComponentCollector({
        idle: IDLE_TIMEOUT_MS,
      });

      collector.on("collect", async (i: MessageComponentInteraction) => {
        try {
          if (i.user.id !== ctx.user.id) {
            await i.reply(
              asEmbed({
                content:
                  "❌ Only the user who initiated the configuration command can use this panel.",
                flags: MessageFlags.Ephemeral as const,
              }),
            );
            return;
          }

          const id = i.customId;

          if (id === "cfg_cancel") {
            collector.stop("cancelled");
            await i.deferUpdate();
            await message.delete().catch(() => {});
            return;
          }

          if (id === "cfg_back") {
            await i.update(pageView(page, guildConfig!));
            return;
          }

          if (id.startsWith("cfg_page_")) {
            page = id.replace("cfg_page_", "") as Page;
            await i.update(pageView(page, guildConfig!));
            return;
          }

          if (id === "cfg_edit_prefix") {
            await i.showModal(
              new ModalBuilder()
                .setCustomId("cfg_prefix_modal")
                .setTitle("Command Prefix")
                .addComponents(
                  new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                      .setCustomId("prefix")
                      .setLabel("New prefix (1-5 characters, no spaces)")
                      .setStyle(TextInputStyle.Short)
                      .setRequired(true)
                      .setMinLength(1)
                      .setMaxLength(5)
                      .setValue(guildConfig!.prefix),
                  ),
                ),
            );
            const modal = await i
              .awaitModalSubmit({
                time: IDLE_TIMEOUT_MS,
                filter: (m) =>
                  m.customId === "cfg_prefix_modal" &&
                  m.user.id === ctx.user.id,
              })
              .catch(() => null);
            if (!modal || !modal.isFromMessage()) return;
            collector.resetTimer();

            const prefix = modal.fields.getTextInputValue("prefix").trim();
            if (!prefix || /\s/.test(prefix)) {
              await modal.reply(
                asEmbed({
                  content: "❌ The prefix can't be empty or contain spaces.",
                  flags: MessageFlags.Ephemeral as const,
                }),
              );
              return;
            }
            guildConfig = await GuildConfigService.updateConfig(guildId, {
              prefix,
            });
            logger.info(
              `Prefix for guild ${guildId} set to ${prefix} by ${ctx.user.tag}`,
            );
            await modal.update(pageView(page, guildConfig));
            return;
          }

          if (id.startsWith("cfg_edit_")) {
            const category = CONFIG_CATEGORIES.find(
              (c) => c.key === id.replace("cfg_edit_", ""),
            );
            if (!category) return;
            await i.update(selectView(category, guildConfig!));
            return;
          }

          if (
            id.startsWith("cfg_select_") &&
            (i.isRoleSelectMenu() || i.isChannelSelectMenu())
          ) {
            const category = CONFIG_CATEGORIES.find(
              (c) => c.key === id.replace("cfg_select_", ""),
            );
            if (!category) return;
            const newValue =
              category.type === "channel" ? (i.values[0] ?? "") : i.values;
            guildConfig = await GuildConfigService.updateConfig(guildId, {
              [category.key]: newValue,
            });
            logger.info(
              `Configuration updated for guild ${guildId} by ${ctx.user.tag}`,
            );
            page = pageOf(category);
            await i.update(pageView(page, guildConfig));
          }
        } catch (error) {
          logger.error("Configuration panel interaction failed:", error);
        }
      });

      collector.once("end", (_, reason) => {
        if (reason !== "idle") return;
        message
          .edit({
            embeds: [
              new EmbedBuilder()
                .setTitle("Configuration closed")
                .setDescription(
                  "Timed out after 5 minutes of inactivity. Run `/server config` again to continue.",
                )
                .setColor(CONSTANTS.EMBED_WARNING_COLOR),
            ],
            components: [],
          })
          .catch((err) =>
            logger.error("Failed to close configuration panel:", err),
          );
      });
    } catch (error) {
      logger.error("Configuration command error:", error);
      await logCommandError(ctx, "/server configuration", error).catch(
        () => {},
      );

      try {
        if (ctx.deferred) {
          await ctx.editReply({
            content: `Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
            embeds: [],
            components: [],
          });
        } else if (!ctx.replied) {
          await ctx.reply({
            content: `Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (e) {
        logger.error("Failed sending error:", e);
      }
    }
  },
} satisfies SubCommand;
