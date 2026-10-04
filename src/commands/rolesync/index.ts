import { PermissionFlagsBits } from "discord.js";
import { defineCommand } from "../../utils/defineCommand.js";
import { prisma } from "../../database/client.js";
import { reconcileTargetRole } from "../../services/RoleSyncService.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/formatters.js";

const linkOptions = [
  {
    name: "role",
    description: "Role in THIS server to grant.",
    type: "role" as const,
    required: true,
  },
  {
    name: "source_server",
    description: "ID of the other server.",
    type: "string" as const,
    required: true,
  },
  {
    name: "source_role",
    description: "ID of the role in the other server that grants it.",
    type: "string" as const,
    required: true,
  },
];

// Links are always created from the TARGET server, so an admin can only ever
// cause roles to be granted in a server they administrate.
export default defineCommand({
  name: "rolesync",
  description: "Sync roles from other servers into this one.",
  guildOnly: true,
  permissions: [PermissionFlagsBits.Administrator],

  subcommands: [
    {
      name: "link",
      description: "Holding a role in another server grants a role here.",
      options: linkOptions,
      execute: async (ctx) => {
        await ctx.defer();
        const role = ctx.getRole("role");
        const sourceGuildId = ctx.getString("source_server")?.trim() ?? "";
        const sourceRoleId = ctx.getString("source_role")?.trim() ?? "";

        const sourceGuild = ctx.client.guilds.cache.get(sourceGuildId);
        const sourceRole = sourceGuild?.roles.cache.get(sourceRoleId);
        const fail = (msg: string) =>
          ctx.editReply({ embeds: [createErrorEmbed("Can't link roles", msg)] });

        if (!role || !ctx.guild) return void (await fail("Pick a role in this server."));
        if (!sourceGuild || sourceGuild.id === ctx.guild.id)
          return void (await fail("The bot isn't in that server (or it's this server)."));
        if (!sourceRole) return void (await fail("That role doesn't exist in the other server."));
        if (!role.editable)
          return void (await fail(`I can't manage ${role} — move my role above it and give me Manage Roles.`));
        if (!(await sourceGuild.members.fetch(ctx.user.id).catch(() => null)))
          return void (await fail("You must be a member of the other server."));

        await prisma.roleLink.upsert({
          where: {
            sourceGuildId_sourceRoleId_targetGuildId_targetRoleId: {
              sourceGuildId,
              sourceRoleId,
              targetGuildId: ctx.guild.id,
              targetRoleId: role.id,
            },
          },
          update: {},
          create: { sourceGuildId, sourceRoleId, targetGuildId: ctx.guild.id, targetRoleId: role.id },
        });

        // Backfill: grant to everyone already holding the source role. Only
        // adds -- existing manual holders of the target role keep it until
        // their roles next change, so a mis-link can't mass-strip a role.
        await sourceGuild.members.fetch();
        for (const member of sourceRole.members.values()) {
          await reconcileTargetRole(ctx.client, member.id, ctx.guild.id, role.id).catch(() => {});
        }

        await ctx.editReply({
          embeds: [
            createSuccessEmbed(
              "Roles linked",
              `**${sourceRole.name}** in **${sourceGuild.name}** now grants ${role} here. Synced ${sourceRole.members.size} existing member(s).`,
            ),
          ],
        });
      },
    },
    {
      name: "unlink",
      description: "Remove a role link (already-granted roles are kept).",
      options: linkOptions,
      execute: async (ctx) => {
        const role = ctx.getRole("role");
        const { count } = await prisma.roleLink.deleteMany({
          where: {
            targetGuildId: ctx.guild!.id,
            targetRoleId: role?.id ?? "",
            sourceGuildId: ctx.getString("source_server")?.trim() ?? "",
            sourceRoleId: ctx.getString("source_role")?.trim() ?? "",
          },
        });
        await ctx.reply({
          embeds: [
            count
              ? createSuccessEmbed("Link removed", `${role} is no longer synced from that role.`)
              : createErrorEmbed("No such link", "Nothing matched. Check `/rolesync list`."),
          ],
        });
      },
    },
    {
      name: "list",
      description: "Show role links into and out of this server.",
      execute: async (ctx) => {
        const guildId = ctx.guild!.id;
        const links = await prisma.roleLink.findMany({
          where: { OR: [{ targetGuildId: guildId }, { sourceGuildId: guildId }] },
        });
        const name = (g: string) => ctx.client.guilds.cache.get(g)?.name ?? g;
        const roleName = (g: string, r: string) =>
          ctx.client.guilds.cache.get(g)?.roles.cache.get(r)?.name ?? r;
        const lines = links.map(
          (l) =>
            `**${roleName(l.sourceGuildId, l.sourceRoleId)}** (${name(l.sourceGuildId)}) → **${roleName(l.targetGuildId, l.targetRoleId)}** (${name(l.targetGuildId)})`,
        );
        await ctx.reply({
          embeds: [
            createSuccessEmbed("Role links", lines.join("\n").slice(0, 4000) || "No links yet."),
          ],
        });
      },
    },
  ],
});
