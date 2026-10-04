import { Client } from "discord.js";
import { prisma } from "../database/client.js";
import { logger } from "../utils/logger.js";

/**
 * Makes `userId`'s targetRoleId in targetGuildId match its links: held if
 * the user holds ANY linked source role, removed otherwise. Deciding from
 * the full set of sources (not just the one that changed) means two
 * departments granting the same main-server role can't strip each other's.
 */
export async function reconcileTargetRole(
  client: Client,
  userId: string,
  targetGuildId: string,
  targetRoleId: string,
): Promise<void> {
  const links = await prisma.roleLink.findMany({
    where: { targetGuildId, targetRoleId },
  });
  if (!links.length) return;

  const member = await client.guilds.cache
    .get(targetGuildId)
    ?.members.fetch(userId)
    .catch(() => null);
  if (!member) return;

  let shouldHave = false;
  for (const link of links) {
    const source = await client.guilds.cache
      .get(link.sourceGuildId)
      ?.members.fetch(userId)
      .catch(() => null);
    if (source?.roles.cache.has(link.sourceRoleId)) {
      shouldHave = true;
      break;
    }
  }

  const has = member.roles.cache.has(targetRoleId);
  if (shouldHave && !has) await member.roles.add(targetRoleId, "Role sync");
  if (!shouldHave && has) await member.roles.remove(targetRoleId, "Role sync");
}

/**
 * Re-syncs every link touching `guildId` for one user. `changedRoleIds`
 * narrows it to links on those roles (role update); omit it for joins/leaves.
 * Links where this guild is the *target* are included too, so a synced role
 * removed or added by hand gets put back in line.
 */
export async function syncMemberRoles(
  client: Client,
  userId: string,
  guildId: string,
  changedRoleIds?: string[],
): Promise<void> {
  const links = await prisma.roleLink.findMany({
    where: {
      OR: [
        {
          sourceGuildId: guildId,
          ...(changedRoleIds && { sourceRoleId: { in: changedRoleIds } }),
        },
        {
          targetGuildId: guildId,
          ...(changedRoleIds && { targetRoleId: { in: changedRoleIds } }),
        },
      ],
    },
  });

  const targets = new Set(
    links.map((l) => `${l.targetGuildId}:${l.targetRoleId}`),
  );
  for (const target of targets) {
    const [targetGuildId, targetRoleId] = target.split(":");
    await reconcileTargetRole(client, userId, targetGuildId, targetRoleId).catch(
      (error) =>
        logger.error(
          `Role sync failed for ${userId} -> ${targetGuildId}/${targetRoleId}:`,
          error,
        ),
    );
  }
}
