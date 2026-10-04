// Minimal stand-ins for Prisma and discord.js objects, shared by the *.test.ts
// files. Only what the code under test actually touches is modelled.
import { prisma } from "../database/client.js";

/**
 * Replaces a Prisma model delegate (e.g. `prisma.roleLink`) for one test.
 * Prisma's delegates are lazy proxies that `mock.method` can't patch, so the
 * whole property is swapped. Returns a restore function.
 */
export function stubPrisma<K extends "roleLink" | "guildConfig">(
  model: K,
  impl: Record<string, (...args: any[]) => unknown>,
): () => void {
  Object.defineProperty(prisma, model, { value: impl, configurable: true });
  return () => {
    delete (prisma as any)[model];
  };
}

/** Records calls so tests can assert on them without a mocking library. */
export function spy<A extends unknown[], R>(impl: (...args: A) => R = (() => undefined) as any) {
  const calls: A[] = [];
  const fn = (...args: A) => {
    calls.push(args);
    return impl(...args);
  };
  return Object.assign(fn, { calls });
}

export interface FakeMember {
  id: string;
  roles: Set<string>;
  nickname: string | null;
  displayName: string;
  isAdmin: boolean;
}

/** A guild whose members/roles live in plain maps; role add/remove mutate them. */
export function fakeGuild(id: string, members: FakeMember[] = []) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const toMember = (m: FakeMember, guild: any) => ({
    id: m.id,
    guild,
    get nickname() {
      return m.nickname;
    },
    get displayName() {
      return m.nickname ?? m.displayName;
    },
    roles: {
      cache: { has: (r: string) => m.roles.has(r) },
      add: async (r: string) => void m.roles.add(r),
      remove: async (r: string) => void m.roles.delete(r),
    },
    permissions: { has: () => m.isAdmin },
    setNickname: async (nick: string | null) => {
      m.nickname = nick;
    },
  });
  const guild: any = {
    id,
    name: `Guild ${id}`,
    members: {
      fetch: async (userId?: string) => {
        if (userId === undefined) return byId;
        const m = byId.get(userId);
        if (!m) throw new Error("Unknown Member");
        return toMember(m, guild);
      },
    },
  };
  return { guild, byId };
}

export function member(id: string, roles: string[] = [], extra: Partial<FakeMember> = {}): FakeMember {
  return { id, roles: new Set(roles), nickname: null, displayName: `user${id}`, isAdmin: false, ...extra };
}

/** A client whose guild cache holds the given fake guilds. */
export function fakeClient(...guilds: any[]) {
  return { guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } } as any;
}
