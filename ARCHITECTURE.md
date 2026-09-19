# Architecture

TypeScript Discord bot (discord.js v14) for San Andreas Roleplay staff
utilities — moderation, ERLC (Emergency Response: Liberty City) server
tooling, and member-sync. Backed by PostgreSQL via Prisma.

## Request flow

```
Discord gateway event
  -> events/{messageCreate,interactionCreate}.ts
  -> loaders/unifiedCommandLoader.ts (already loaded at startup)
  -> middleware/{cooldown,permissions,commandLogger}.ts
  -> commands/<category>/<command>.ts
```

- **`src/loaders/unifiedCommandLoader.ts`** — walks `src/commands/<category>/`
  at startup; **one file defines one command**, registered as both a prefix
  command (`byName`/`byAlias`) and a slash command (`slashData`) from a
  single `UnifiedCommand` definition (`src/types/UnifiedCommand.ts`,
  `src/utils/defineCommand.ts`). There's no separate slash-only or
  prefix-only command set to keep in sync.
- **`src/events/`** — thin gateway event handlers that dispatch into the
  loaded command map; `ready.ts` also registers slash commands with Discord
  on boot.
- **`src/middleware/`** — `cooldown.ts` (per-user per-command), `permissions.ts`
  (Discord permission checks), `commandLogger.ts` (audit logging).
- **`src/commands/`** — `moderation/`(`supervision/infract.ts`), `erlc/`
  (Emergency Response Liberty City API integration — `info`, `players`,
  `run`), `server/` (per-guild config), `session/`, `utility/`.
- **`src/services/`** — business logic shared across commands and
  background jobs: `GuildConfigService` (per-guild settings), `SyncService`
  (member roster sync, shared by the manual `/sync` command and
  `jobs/syncScheduler.ts`'s periodic background sync), `CommandHandler`.
- **`src/jobs/syncScheduler.ts`** — periodic background member sync (see the
  `🔄 Background sync for <guild>` log lines).
- **`src/database/client.ts`** — Prisma client singleton + connect/disconnect
  lifecycle, called from `index.ts` on startup/shutdown.
- **`djsko`** (sibling workspace package) is wired in directly in
  `index.ts` as an owner-only debug console (`Jishaku`) — see
  [SECURITY.md](./SECURITY.md).

## Data model (`prisma/schema.prisma`)

- **`GuildConfig`** — per-guild settings: prefix, mod-log channel, and the
  role-ID lists (`directiveRoles`, `seniorHrRoles`, `managementRoles`,
  `supervisorRoles`, `administratorRoles`, `moderatorRoles`) that drive
  permission checks.
- **`User`** — synced member roster: Discord user ID, username, roles,
  guilds. Populated/refreshed by `SyncService`.
- **`Infraction`** — moderation case log, relates to `User` by `userId`.
- **`CommandCooldown`** — backs the cooldown middleware.

## Deployment

Production topology (Docker image, systemd units, webhook/timer auto-deploy)
is covered in `README.md`'s Deployment section and `DEBUG_CHEATSHEET.md`.
