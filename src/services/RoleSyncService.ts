import { Client } from "discord.js";
import { prisma } from "../database/client.js";
import { logger } from "../utils/logger.js";

// Links are stored as directed rows, and `/rolesync link` writes both
// directions, so a pair of linked roles mirrors each other: gaining or losing
// either one does the same to the other. Every linked role is therefore
// equivalent to its partners -- linking one main-server role to two
// department roles keeps all three in step.

async function setRole(
  client: Client,
  userId: string,
  guildId: string,
  roleId: string,
  shouldHave: boolean,
): Promise<void> {
  const member = await client.guilds.cache
    .get(guildId)
    ?.members.fetch(userId)
    .catch(() => null);
  if (!member) return;

  const has = member.roles.cache.has(roleId);
  // No-op when already in the right state -- this is also what stops the
  // update events our own changes trigger from bouncing back and forth.
  if (shouldHave && !has) await member.roles.add(roleId, "Role sync");
  if (!shouldHave && has) await member.roles.remove(roleId, "Role sync");
}

async function applyToLinks(
  client: Client,
  userId: string,
  links: { targetGuildId: string; targetRoleId: string }[],
  shouldHave: boolean,
): Promise<void> {
  for (const { targetGuildId, targetRoleId } of links) {
    await setRole(client, userId, targetGuildId, targetRoleId, shouldHave).catch(
      (error) =>
        logger.error(
          `Role sync failed for ${userId} -> ${targetGuildId}/${targetRoleId}:`,
          error,
        ),
    );
  }
}

/** A member gained or lost `roleId` in `guildId`: mirror it to every linked role. */
export async function onRoleChanged(
  client: Client,
  userId: string,
  guildId: string,
  roleId: string,
  has: boolean,
): Promise<void> {
  const links = await prisma.roleLink.findMany({
    where: { sourceGuildId: guildId, sourceRoleId: roleId },
  });
  await applyToLinks(client, userId, links, has);
}

/** A member joined `guildId`: grant any role here they hold a link for elsewhere. */
export async function onMemberJoined(
  client: Client,
  userId: string,
  guildId: string,
): Promise<void> {
  const links = await prisma.roleLink.findMany({
    where: { targetGuildId: guildId },
  });
  for (const link of links) {
    const source = await client.guilds.cache
      .get(link.sourceGuildId)
      ?.members.fetch(userId)
      .catch(() => null);
    if (source?.roles.cache.has(link.sourceRoleId)) {
      await applyToLinks(client, userId, [link], true);
    }
  }
}

/** A member left `guildId`: treat it as losing every linked role they had there. */
export async function onMemberLeft(
  client: Client,
  userId: string,
  guildId: string,
): Promise<void> {
  const links = await prisma.roleLink.findMany({
    where: { sourceGuildId: guildId },
  });
  await applyToLinks(client, userId, links, false);
}

/** Backfill after linking: grant `targetRoleId` to everyone holding the source role. Add-only. */
export async function grantToHolders(
  client: Client,
  memberIds: Iterable<string>,
  targetGuildId: string,
  targetRoleId: string,
): Promise<void> {
  for (const userId of memberIds) {
    await applyToLinks(client, userId, [{ targetGuildId, targetRoleId }], true);
  }
}
