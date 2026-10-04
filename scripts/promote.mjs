// `jsk promote` runs this inside the bot's container. It asks the host's promote
// receiver (sarp-utilities/webhook-server.cjs, 127.0.0.1:29017) to fast-forward
// main to testing. The request is HMAC-signed with PROMOTE_SECRET plus a
// timestamp, so the secret never goes over the wire and requests can't be replayed.
// Usage: node scripts/promote.mjs <bot>
import crypto from "node:crypto";

const secret = process.env.PROMOTE_SECRET;
const bot = process.argv[2];
if (!secret || !bot) {
  console.error("Usage: PROMOTE_SECRET=... node scripts/promote.mjs <bot>");
  process.exit(1);
}

const body = JSON.stringify({ bot });
const timestamp = String(Date.now());
const signature =
  "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

const res = await fetch(process.env.PROMOTE_URL ?? "http://127.0.0.1:29017/promote", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Promote-Timestamp": timestamp,
    "X-Promote-Signature": signature,
  },
  body,
  signal: AbortSignal.timeout(150_000),
});

console.log(await res.text());
if (!res.ok) process.exit(1);
