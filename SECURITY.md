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

`index.ts` wires up `djsko`'s `Jishaku` with an `owners` list (`JSK_OWNERS`)
and a narrower `shellOwners` list (`JSK_SHELL_OWNERS`) of Discord user IDs,
both comma-separated in `.env`. If either is unset the console is closed to
everyone rather than falling back to djsko's default of the application
owner. Security mode is on, so jsk output (including `-jsk update`'s deploy
log) has env secrets redacted. Anyone on the owners list can:

- run arbitrary JavaScript in the bot process (`jsk js`/`jsk cjs`/`jsk mjs`)
  — full read access to `process.env`, the Prisma client, and anything else
  in scope;
- run arbitrary shell commands on the host, if also in `shellOwners`
  (`jsk sh`);
- trigger a production deploy and service restart from a Discord message
  (`updateCommand`/`restartCommand` run `deploy-sarp.sh` and
  `systemctl --user restart sarp-utilities.service` directly).

**Treat `JSK_OWNERS` like a list of people with root on the
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

## Promote receiver (`webhook-server.cjs`, port 29017)

`jsk promote` runs inside the bots' containers, which can't touch the host's
repos, so it asks this receiver to run the host-side promote script. It
listens on `127.0.0.1:29017` (`PROMOTE_PORT`; set `PROMOTE_URL` in the bots to match if changed), a separate port from the tunneled `9000`, so it
is never reachable from the internet. Requests carrying proxy headers
(`Cf-Ray`, `Cf-Connecting-Ip`, `X-Forwarded-For`) are refused anyway.

Each request is HMAC-SHA256 signed over `timestamp.body` with
`PROMOTE_SECRET` (separate from `WEBHOOK_SECRET`, at least 32 chars, or the
receiver doesn't start). The secret never goes over the wire. Requests more
than 60s old, or whose signature was already used, are rejected. The body is
capped at 1 KB and only names a key in the fixed `PROMOTE_SCRIPTS` map, which
is run with `execFile` (no shell). Only one promote runs at a time. The
script only fast-forwards `main` to `testing` (it refuses a non-fast-forward
in any repo before pushing anything), and the resulting push deploys through
the normal webhook.

`PROMOTE_SECRET` must be set in the webhook server's environment and in both
bots' `.env`. Anyone who can read either bot's `.env`, or run `jsk` eval/shell,
can promote.
