import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  PermissionsBitField,
  ComponentType,
  MessageFlags,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ButtonInteraction,
} from "discord.js";
import { CONSTANTS } from "../../config/constants.js";
import { prisma } from "../../database/client.js";
import type { GuildConfig } from "../../generated/prisma/client.js";
import { config } from "../../config/config.js";
import { logger } from "../../utils/logger.js";
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

type ChannelCategoryKey = "infractionChannel" | "logsChannel";

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
];

function createConfigEmbed(guildConfig: GuildConfig | null) {
  const embed = new EmbedBuilder()
    .setTitle("Server Configuration")
    .setDescription("Current configuration for this server")
    .setColor(CONSTANTS.EMBED_COLOR)
    .setTimestamp();

  if (!guildConfig) {
    embed.addFields({
      name: "Configuration",
      value: "No configuration has been created yet.",
    });

    return embed;
  }

  for (const category of CONFIG_CATEGORIES) {
    if (category.type === "role") {
      const roles = guildConfig[category.key];
      const rolesDisplay =
        Array.isArray(roles) && roles.length > 0
          ? roles.map((id) => `<@&${id}>`).join(", ")
          : "No roles assigned";

      embed.addFields({
        name: category.title,
        value: rolesDisplay,
        inline: false,
      });
    } else {
      const channelId = guildConfig[category.key];
      embed.addFields({
        name: category.title,
        value: channelId ? `<#${channelId}>` : "Not set",
        inline: false,
      });
    }
  }

  return embed;
}

function createEditButtons() {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();
  let buttonCount = 0;

  for (const category of CONFIG_CATEGORIES) {
    if (buttonCount === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
      buttonCount = 0;
    }

    const button = new ButtonBuilder()
      .setCustomId(`config_edit_${category.key}`)
      .setLabel(`Edit ${category.title}`)
      .setStyle(1); // Blue button

    currentRow.addComponents(button);
    buttonCount++;
  }

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  return rows;
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

    const guild = ctx.guild;
    const guildId = guild.id;

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

      const configEmbed = createConfigEmbed(guildConfig);
      const editButtons = createEditButtons();

      const message = await ctx.editReply({
        embeds: [configEmbed],
        components: editButtons,
      });

      const waitForButton = async (): Promise<void> => {
        const buttonCollector = message.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 60000,
        });

        buttonCollector.on(
          "collect",
          async (buttonInteraction: ButtonInteraction) => {
            if (buttonInteraction.user.id !== ctx.user.id) {
              await buttonInteraction.reply({
                content:
                  "Only the user who initiated the configuration command can interact with these buttons.",
                flags: MessageFlags.Ephemeral,
              });
              return;
            }

            const categoryKey = buttonInteraction.customId.replace(
              "config_edit_",
              "",
            ) as ConfigCategoryKey;

            const category = CONFIG_CATEGORIES.find(
              (c) => c.key === categoryKey,
            );

            if (!category) {
              await buttonInteraction.reply({
                content: "Invalid category.",
                flags: MessageFlags.Ephemeral,
              });
              return;
            }

            const isChannel = category.type === "channel";

            await buttonInteraction.reply({
              embeds: [
                new EmbedBuilder()
                  .setTitle(`Edit ${category.title}`)
                  .setDescription(category.description)
                  .addFields({
                    name: "Instructions",
                    value: isChannel
                      ? "Choose a channel from the menu below. Submit without selecting to clear it."
                      : "Choose one or more roles from the menu below. Submit without selecting roles to clear this category.",
                  })
                  .setColor(CONSTANTS.EMBED_COLOR)
                  .setTimestamp(),
              ],
              components: [
                isChannel
                  ? new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
                      new ChannelSelectMenuBuilder()
                        .setCustomId(`config_select_${categoryKey}`)
                        .setPlaceholder(
                          `Select a channel for ${category.title}`,
                        )
                        .setChannelTypes(
                          category.type === "channel" && category.channelTypes
                            ? category.channelTypes
                            : [ChannelType.GuildText],
                        )
                        .setMinValues(0)
                        .setMaxValues(1),
                    )
                  : new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
                      new RoleSelectMenuBuilder()
                        .setCustomId(`config_select_${categoryKey}`)
                        .setPlaceholder(`Select roles for ${category.title}`)
                        .setMinValues(0)
                        .setMaxValues(25),
                    ),
              ],
              flags: MessageFlags.Ephemeral,
            });

            const selectMessage = await buttonInteraction.fetchReply();

            try {
              const selectInteraction =
                await selectMessage.awaitMessageComponent({
                  componentType: isChannel
                    ? ComponentType.ChannelSelect
                    : ComponentType.RoleSelect,
                  time: 60000,
                  filter: (i) => i.user.id === ctx.user.id,
                });

              const newValue: string | string[] = isChannel
                ? (selectInteraction.values[0] ?? "")
                : selectInteraction.values;

              (guildConfig as unknown as Record<string, string | string[]>)[
                categoryKey
              ] = newValue;

              await GuildConfigService.updateConfig(guildId, {
                [categoryKey]: newValue,
              });

              const updatedDescription = isChannel
                ? newValue
                  ? `Now set to: <#${newValue}>`
                  : "Cleared — no channel set"
                : (newValue as string[]).length > 0
                  ? `Now set to: ${(newValue as string[])
                      .map((id) => `<@&${id}>`)
                      .join(", ")}`
                  : "No roles assigned";

              await selectInteraction.update({
                embeds: [
                  new EmbedBuilder()
                    .setTitle(`${category.title} Updated`)
                    .setDescription(updatedDescription)
                    .setColor(CONSTANTS.EMBED_COLOR)
                    .setTimestamp(),
                ],
                components: [],
              });

              await message.edit({
                embeds: [createConfigEmbed(guildConfig)],
                components: editButtons,
              });

              logger.info(
                `Configuration updated for guild ${guildId} by ${ctx.user.tag}`,
              );

              // Restart the 60 second button timer
              await waitForButton();
            } catch {
              await selectMessage.edit({
                embeds: [
                  new EmbedBuilder()
                    .setTitle("Selection Timed Out")
                    .setDescription("No selection was made within 60 seconds.")
                    .setColor(CONSTANTS.EMBED_WARNING_COLOR),
                ],
                components: [],
              });

              // Return to the main configuration menu
              await message.edit({
                embeds: [createConfigEmbed(guildConfig)],
                components: editButtons,
              });

              await waitForButton();
            }
          },
        );

        buttonCollector.once("end", (_, reason) => {
          if (reason !== "time") return;

          const disabledRows = editButtons.map((row) => {
            const newRow = new ActionRowBuilder<ButtonBuilder>();

            row.components.forEach((component) => {
              if (component instanceof ButtonBuilder) {
                newRow.addComponents(
                  ButtonBuilder.from(component).setDisabled(true),
                );
              }
            });

            return newRow;
          });

          ctx
            .editReply({
              content:
                "⏰ Configuration timed out after 60 seconds. Please run `/server configuration` again.",
              embeds: [],
              components: disabledRows,
            })
            .catch((err) => logger.error("Failed to update timeout:", err));
        });
      };

      await waitForButton();
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
