# Security

## Secrets

`BOT_TOKEN`, `CLIENT_SECRET`, `ERLC_API_KEY`, `DATABASE_URL`, and
`WEBHOOK_SECRET` (the last for `webhook-server.cjs`) live only in `.env`
files, gitignored, never committed. In production they're passed to the
container via `docker run --env-file`, not baked into the image.

**Gotcha**: Docker's `--env-file` parser is stricter than the `dotenv`
library and than systemd's old `EnvironmentFile=` — it doesn't strip
surrounding quotes or tolerate `KEY = value` spacing. If `.env` predates the
Docker migration, check for both before assuming a token is wrong; see
`DEBUG_CHEATSHEET.md`.

## Permission model

Discord-native, no separate auth system:

- **Command-level**: `middleware/permissions.ts` checks the invoking
  member's Discord permissions (e.g. `ManageMessages`) before running a
  restricted command.
- **Guild-level roles**: `GuildConfig`'s role-ID lists (`directiveRoles`,
  `seniorHrRoles`, `managementRoles`, `supervisorRoles`,
  `administratorRoles`, `moderatorRoles`) drive which roles can act on
  moderation/ERLC commands in a given guild — configured per-guild via the
  `server` commands, not hardcoded.
- **Bot owners**: a separate, much higher-privilege tier — see below.

## `djsko`/Jishaku owner console

`index.ts` wires up `djsko`'s `Jishaku` with a hardcoded `owners` (and a
narrower `shellOwners`) list of Discord user IDs. Anyone on that list can:

- run arbitrary JavaScript in the bot process (`jsk js`/`jsk cjs`/`jsk mjs`)
  — full read access to `process.env`, the Prisma client, and anything else
  in scope;
- run arbitrary shell commands on the host, if also in `shellOwners`
  (`jsk sh`);
- trigger a production deploy and service restart from a Discord message
  (`updateCommand`/`restartCommand` run `deploy-sarp.sh` and
  `systemctl --user restart sarp-utilities.service` directly).

**Treat the owner list in `index.ts` like a list of people with root on the
production host — because they effectively have it.** See
`djsko/SECURITY.md` for what djsko's security mode does and doesn't protect
against (output redaction, not access control).

## Webhook receiver (`webhook-server.cjs`)

Binds to `127.0.0.1:9000` only, reached externally through an ephemeral
Cloudflare quick-tunnel URL (`sarp-tunnel.service`), not a stable public
address. Every request is HMAC-SHA256 verified against `WEBHOOK_SECRET`
(`X-Hub-Signature-256`, compared with `crypto.timingSafeEqual`) before
anything else runs — an unsigned or mis-signed request gets a 401 and never
reaches the deploy logic. The repo name from the (now-verified) payload is
looked up in a fixed `DEPLOY_SCRIPTS` map rather than used to build a
command string, so there's no injection surface via the payload itself —
only the mapped script path is ever executed.
