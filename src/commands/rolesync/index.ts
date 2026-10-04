import { PermissionFlagsBits } from "discord.js";
import { defineCommand } from "../../utils/defineCommand.js";
import { prisma } from "../../database/client.js";
import { grantToHolders } from "../../services/RoleSyncService.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/formatters.js";

const linkOptions = [
  {
    name: "role",
    description: "Role in THIS server.",
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
    description: "ID of the role in the other server.",
    type: "string" as const,
    required: true,
  },
];

// Links are two-way, so they grant roles in BOTH servers -- the invoker must
// be an admin in both (this one via `permissions`, the other checked below).
export default defineCommand({
  name: "rolesync",
  description: "Keep roles in sync between this server and another.",
  guildOnly: true,
  permissions: [PermissionFlagsBits.Administrator],

  subcommands: [
    {
      name: "link",
      description: "Link a role here with a role in another server (two-way).",
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
        for (const r of [role, sourceRole]) {
          if (!r.editable)
            return void (await fail(`I can't manage **${r.name}** in **${r.guild.name}** — move my role above it and give me Manage Roles there.`));
        }
        const otherMember = await sourceGuild.members.fetch(ctx.user.id).catch(() => null);
        if (!otherMember?.permissions.has(PermissionFlagsBits.Administrator))
          return void (await fail(`You must be an administrator in **${sourceGuild.name}** too.`));

        const here = { guildId: ctx.guild.id, roleId: role.id };
        const there = { guildId: sourceGuildId, roleId: sourceRoleId };
        for (const [from, to] of [[here, there], [there, here]]) {
          const link = {
            sourceGuildId: from.guildId,
            sourceRoleId: from.roleId,
            targetGuildId: to.guildId,
            targetRoleId: to.roleId,
          };
          await prisma.roleLink.upsert({
            where: { sourceGuildId_sourceRoleId_targetGuildId_targetRoleId: link },
            update: {},
            create: link,
          });
        }

        // Backfill both ways. Only adds -- nobody loses a role at link time,
        // so a mis-link can't mass-strip one.
        await Promise.all([ctx.guild.members.fetch(), sourceGuild.members.fetch()]);
        await grantToHolders(ctx.client, sourceRole.members.keys(), ctx.guild.id, role.id);
        await grantToHolders(ctx.client, role.members.keys(), sourceGuildId, sourceRoleId);

        await ctx.editReply({
          embeds: [
            createSuccessEmbed(
              "Roles linked",
              `${role} here and **${sourceRole.name}** in **${sourceGuild.name}** are now kept in sync both ways. Synced ${role.members.size + sourceRole.members.size} existing holder(s).`,
            ),
          ],
        });
      },
    },
    {
      name: "unlink",
      description: "Remove a role link, both ways (already-granted roles are kept).",
      options: linkOptions,
      execute: async (ctx) => {
        const role = ctx.getRole("role");
        const here = { guildId: ctx.guild!.id, roleId: role?.id ?? "" };
        const there = {
          guildId: ctx.getString("source_server")?.trim() ?? "",
          roleId: ctx.getString("source_role")?.trim() ?? "",
        };
        const { count } = await prisma.roleLink.deleteMany({
          where: {
            OR: [[here, there], [there, here]].map(([from, to]) => ({
              sourceGuildId: from.guildId,
              sourceRoleId: from.roleId,
              targetGuildId: to.guildId,
              targetRoleId: to.roleId,
            })),
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
        const key = (g: string, r: string, g2: string, r2: string) => `${g}/${r}|${g2}/${r2}`;
        const all = new Set(links.map((l) => key(l.sourceGuildId, l.sourceRoleId, l.targetGuildId, l.targetRoleId)));
        const seen = new Set<string>();
        const lines = links.flatMap((l) => {
          const k = key(l.sourceGuildId, l.sourceRoleId, l.targetGuildId, l.targetRoleId);
          const reverse = key(l.targetGuildId, l.targetRoleId, l.sourceGuildId, l.sourceRoleId);
          if (seen.has(reverse)) return [];
          seen.add(k);
          const arrow = all.has(reverse) ? "↔" : "→";
          return [
            `**${roleName(l.sourceGuildId, l.sourceRoleId)}** (${name(l.sourceGuildId)}) ${arrow} **${roleName(l.targetGuildId, l.targetRoleId)}** (${name(l.targetGuildId)})`,
          ];
        });
        await ctx.reply({
          embeds: [
            createSuccessEmbed("Role links", lines.join("\n").slice(0, 4000) || "No links yet."),
          ],
        });
      },
    },
  ],
});
