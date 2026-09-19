# SARP Utilities — Debugging Cheat Sheet

All commands below run as the `sarp` user unless noted otherwise.
If you just got a fresh `sudo -iu sarp` shell and `systemctl --user`
commands fail with a DBUS/XDG_RUNTIME_DIR error, run this first:

```
export XDG_RUNTIME_DIR=/run/user/$(id -u)
```

## Bot logs

Live/follow:

```
journalctl --user -u sarp-utilities -f
```

Last 50 lines, no follow:

```
journalctl --user -u sarp-utilities -n 50 --no-pager
```

Since a specific time:

```
journalctl --user -u sarp-utilities --since "10 minutes ago" --no-pager
```

Look for: `Bot initialized successfully`, `Logged in as SARP Utilities#...`,
`Slash commands registered successfully`, and no repeated restart-loop lines
after that.

## Webhook receiver logs

Live/follow — shows incoming GitHub pushes AND the deploy output triggered
by them (since the webhook runs deploy-sarp.sh directly):

```
journalctl --user -u sarp-webhook -f
```

## Polling-timer deploy logs

Only shows output when `sarp-deploy.timer` fires the fallback poll (not
webhook-triggered deploys — those log under `sarp-webhook` instead):

```
journalctl --user -u sarp-deploy -f
```

Check when it's next scheduled to run:

```
systemctl --user list-timers
```

## Cloudflare tunnel

Live/follow:

```
journalctl --user -u sarp-tunnel -f
```

Get the tunnel's current URL (it changes on every restart):

```
journalctl --user -u sarp-tunnel --no-pager | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' | tail -1
```

If it doesn't match what's saved in GitHub's webhook settings for either
repo, that's why pushes stopped triggering deploys — update it there.

## Service status (any of the four)

```
systemctl --user status sarp-utilities.service
systemctl --user status sarp-webhook.service
systemctl --user status sarp-deploy.service
systemctl --user status sarp-tunnel.service
```

See all of them at once:

```
systemctl --user list-units --type=service
```

## Manual actions

Trigger a deploy right now, without waiting on a push or the timer:

```
/opt/sarp-project/sarp-utilities/deploy-sarp.sh
```

Restart just the bot (e.g. after manually editing `.env`):

```
systemctl --user restart sarp-utilities.service
```

Reload systemd after editing any `.service`/`.timer` file (not needed for
plain script edits like `deploy-sarp.sh`):

```
systemctl --user daemon-reload
```

## Database

Test the bot's DB connection directly:

```
psql "postgresql://sarp_bot:PASSWORD@localhost:5432/sarp_utilities" -c "SELECT 1;"
```

Open a shell into the bot's database:

```
psql -U sarp_bot -d sarp_utilities -h localhost -W
```

## Ownership / permissions sanity check

Run as `kondd` if `sarp` can't read/write something in `/opt/sarp-project`:

```
sudo ls -la /opt/sarp-project/sarp-utilities
sudo chown -R sarp:sarp /opt/sarp-project/
```

## Docker

Bot runs as a container (`--rm --name sarp-utilities`), not a bare `node`
process — `journalctl` above still works since it's foregrounded under
systemd, but these are useful too:

```
docker ps                                  # confirm it's up, check uptime
docker logs -f sarp-utilities              # same output as journalctl, if you're already at a docker prompt
docker exec -it sarp-utilities sh          # shell into the running container
```

Rebuild the image manually (context must be repo root, not this directory):

```
cd /opt/sarp-project
docker build -f sarp-utilities/Dockerfile -t sarp-utilities:latest .
```

If `.env` was edited and the container fails with `TokenInvalid` or an
`invalid env file` error, check for values wrapped in quotes or key names
with trailing spaces (`KEY = value`) — `systemd`'s `EnvironmentFile=`
tolerated both, but Docker's `--env-file` doesn't.

## GitHub side

Repo → Settings → Webhooks → click the webhook → **Recent Deliveries** tab.
Green = 200 response (arrived and was accepted). Red = check the response
code shown there — a 502 means the tunnel URL is stale or the receiver's
down, not a GitHub-side problem.
