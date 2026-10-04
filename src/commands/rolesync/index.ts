import { PermissionFlagsBits } from "discord.js";
import { defineCommand } from "../../utils/defineCommand.js";
import { prisma } from "../../database/client.js";
import { grantToHolders } from "../../services/RoleSyncService.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/formatters.js";

const pairOptions = [
  {
    name: "this_server_role",
    description: "The role in this server.",
    type: "role" as const,
    required: true,
  },
  {
    name: "other_server_id",
    description: "ID of the other server.",
    type: "string" as const,
    required: true,
  },
  {
    name: "other_server_role_id",
    description: "ID of the role in the other server.",
    type: "string" as const,
    required: true,
  },
];

const DIRECTIONS = {
  both: "Two-way (either role grants/removes the other)",
  to_here: "One-way: other server's role → this server's role",
  to_other: "One-way: this server's role → other server's role",
} as const;
type Direction = keyof typeof DIRECTIONS;

// A link can only grant roles in servers the invoker administrates: this one
// via `permissions`, the other checked below whenever the link writes there.
export default defineCommand({
  name: "rolesync",
  description: "Keep roles in sync between this server and another.",
  guildOnly: true,
  permissions: [PermissionFlagsBits.Administrator],

  subcommands: [
    {
      name: "link",
      description: "Link a role here with a role in another server.",
      options: [
        ...pairOptions,
        {
          name: "direction",
          description: "Which way roles sync. Default: two-way.",
          type: "string" as const,
          required: false,
          choices: Object.entries(DIRECTIONS).map(([value, name]) => ({ name, value })),
        },
      ],
      execute: async (ctx) => {
        await ctx.defer();
        const role = ctx.getRole("this_server_role");
        const sourceGuildId = ctx.getString("other_server_id")?.trim() ?? "";
        const sourceRoleId = ctx.getString("other_server_role_id")?.trim() ?? "";
        const direction = (ctx.getString("direction")?.trim() || "both") as Direction;

        const sourceGuild = ctx.client.guilds.cache.get(sourceGuildId);
        const sourceRole = sourceGuild?.roles.cache.get(sourceRoleId);
        const fail = (msg: string) =>
          ctx.editReply({ embeds: [createErrorEmbed("Can't link roles", msg)] });

        if (!(direction in DIRECTIONS))
          return void (await fail(`Direction must be one of: ${Object.keys(DIRECTIONS).join(", ")}.`));
        if (!role || !ctx.guild) return void (await fail("Pick a role in this server."));
        if (!sourceGuild || sourceGuild.id === ctx.guild.id)
          return void (await fail("The bot isn't in that server (or it's this server)."));
        if (!sourceRole) return void (await fail("That role doesn't exist in the other server."));
        const grantsHere = direction !== "to_other";
        const grantsThere = direction !== "to_here";
        // Only roles the link actually grants need to be manageable.
        for (const r of [grantsHere && role, grantsThere && sourceRole]) {
          if (r && !r.editable)
            return void (await fail(`I can't manage **${r.name}** in **${r.guild.name}** — move my role above it and give me Manage Roles there.`));
        }
        const otherMember = await sourceGuild.members.fetch(ctx.user.id).catch(() => null);
        if (!otherMember)
          return void (await fail(`You must be a member of **${sourceGuild.name}**.`));
        if (grantsThere && !otherMember.permissions.has(PermissionFlagsBits.Administrator))
          return void (await fail(`This link grants roles in **${sourceGuild.name}**, so you must be an administrator there too.`));

        const here = { guildId: ctx.guild.id, roleId: role.id };
        const there = { guildId: sourceGuildId, roleId: sourceRoleId };
        const pairs = [
          ...(grantsHere ? [[there, here]] : []),
          ...(grantsThere ? [[here, there]] : []),
        ];
        for (const [from, to] of pairs) {
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
        let synced = 0;
        if (grantsHere) {
          await grantToHolders(ctx.client, sourceRole.members.keys(), ctx.guild.id, role.id);
          synced += sourceRole.members.size;
        }
        if (grantsThere) {
          await grantToHolders(ctx.client, role.members.keys(), sourceGuildId, sourceRoleId);
          synced += role.members.size;
        }

        const thereLabel = `**${sourceRole.name}** in **${sourceGuild.name}**`;
        const summary = {
          both: `${role} here and ${thereLabel} are now kept in sync both ways.`,
          to_here: `${thereLabel} now grants ${role} here (one-way).`,
          to_other: `${role} here now grants ${thereLabel} (one-way).`,
        }[direction];
        await ctx.editReply({
          embeds: [
            createSuccessEmbed("Roles linked", `${summary} Synced ${synced} existing holder(s).`),
          ],
        });
      },
    },
    {
      name: "unlink",
      description: "Remove a role link, both ways (already-granted roles are kept).",
      options: pairOptions,
      execute: async (ctx) => {
        const role = ctx.getRole("this_server_role");
        const here = { guildId: ctx.guild!.id, roleId: role?.id ?? "" };
        const there = {
          guildId: ctx.getString("other_server_id")?.trim() ?? "",
          roleId: ctx.getString("other_server_role_id")?.trim() ?? "",
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
              ? createSuccessEmbed("Link removed", `${role} is no longer linked to that role (either direction).`)
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
