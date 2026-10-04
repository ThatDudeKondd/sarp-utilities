// Runs the real webhook-server.cjs as a child process on spare ports and hits
// it over HTTP: GitHub deploy webhook checks, and the promote receiver's
// signature / replay / staleness / size / proxy defences.
import assert from "node:assert/strict";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WEBHOOK_SECRET = "webhook-secret";
const PROMOTE_SECRET = "p".repeat(40);
const WEBHOOK_PORT = 39_000 + Math.floor(Math.random() * 500);
const PROMOTE_PORT = WEBHOOK_PORT + 500;

let server: ChildProcess;
let output = "";

function startServer(env: Record<string, string>): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "webhook-server.cjs")], {
      env: { PATH: process.env.PATH, WEBHOOK_PORT: String(WEBHOOK_PORT), PROMOTE_PORT: String(PROMOTE_PORT), ...env },
    });
    let seen = "";
    const onData = (d: Buffer) => {
      seen += d;
      output += d;
      if (seen.includes("Webhook receiver listening") && /promote receiver/i.test(seen)) {
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${seen}`)));
  });
}

const sign = (secret: string, data: string) => "sha256=" + crypto.createHmac("sha256", secret).update(data).digest("hex");

function github(body: object, { event = "push", secret = WEBHOOK_SECRET } = {}) {
  const raw = JSON.stringify(body);
  return fetch(`http://127.0.0.1:${WEBHOOK_PORT}/webhook`, {
    method: "POST",
    headers: { "x-github-event": event, "x-hub-signature-256": sign(secret, raw) },
    body: raw,
  });
}

function promote(bot: string, { secret = PROMOTE_SECRET, timestamp = String(Date.now()), headers = {} as Record<string, string>, signature = "" } = {}) {
  const body = JSON.stringify({ bot });
  return fetch(`http://127.0.0.1:${PROMOTE_PORT}/promote`, {
    method: "POST",
    headers: {
      "X-Promote-Timestamp": timestamp,
      "X-Promote-Signature": signature || sign(secret, `${timestamp}.${body}`),
      ...headers,
    },
    body,
  });
}

before(async () => {
  server = await startServer({ WEBHOOK_SECRET, PROMOTE_SECRET });
});
after(() => server?.kill());

describe("GitHub deploy webhook", () => {
  test("rejects a bad signature", async () => {
    const res = await github({ ref: "refs/heads/main" }, { secret: "wrong" });
    assert.equal(res.status, 401);
  });

  test("ignores non-push events and pushes to other branches", async () => {
    assert.match(await (await github({}, { event: "ping" })).text(), /not a push/);
    assert.match(await (await github({ ref: "refs/heads/testing" })).text(), /not main/);
  });

  test("ignores repos with no deploy script", async () => {
    const res = await github({ ref: "refs/heads/main", repository: { full_name: "someone/else" } });
    assert.match(await res.text(), /unconfigured repo/);
  });

  test("only POST /webhook exists on the public port", async () => {
    assert.equal((await fetch(`http://127.0.0.1:${WEBHOOK_PORT}/webhook`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${WEBHOOK_PORT}/promote`, { method: "POST" })).status, 404);
  });
});

describe("promote receiver", () => {
  test("a correctly signed request reaches the mapped script", async () => {
    // The script lives under /opt on the server, so here it fails to spawn --
    // which still proves the request got past every check.
    const res = await promote("sarp-utilities");
    assert.equal(res.status, 500);
    assert.match(await res.text(), /promote-sarp\.sh/);
  });

  test("the bots' client script signs requests the receiver accepts", async () => {
    const run = promisify(execFile);
    const err = await run(process.execPath, [path.join(ROOT, "scripts/promote.mjs"), "sarp-tickets"], {
      env: { PROMOTE_SECRET, PROMOTE_URL: `http://127.0.0.1:${PROMOTE_PORT}/promote` },
    }).catch((e) => e);
    // Exit 1 because the /opt script is missing here, but not a signature failure.
    assert.match(err.stdout, /promote-sarp-tickets\.sh/);
    assert.doesNotMatch(err.stdout, /Invalid signature/);
  });

  test("rejects a wrong secret", async () => {
    const res = await promote("sarp-utilities", { secret: "x".repeat(40) });
    assert.equal(res.status, 401);
    assert.equal(await res.text(), "Invalid signature");
  });

  test("rejects a replayed request", async () => {
    const timestamp = String(Date.now());
    const body = JSON.stringify({ bot: "nope" });
    const signature = sign(PROMOTE_SECRET, `${timestamp}.${body}`);
    await promote("nope", { timestamp, signature });
    const res = await promote("nope", { timestamp, signature });
    assert.equal(await res.text(), "Replayed request");
  });

  test("rejects stale and future timestamps", async () => {
    for (const offset of [-120_000, 120_000]) {
      const res = await promote("sarp-utilities", { timestamp: String(Date.now() + offset) });
      assert.equal(await res.text(), "Stale request");
    }
  });

  test("rejects unknown bots, including prototype keys", async () => {
    for (const bot of ["nope", "__proto__", "constructor"]) {
      const res = await promote(bot);
      assert.equal(res.status, 400);
      assert.equal(await res.text(), "Unknown bot");
    }
  });

  test("refuses anything that came through a proxy or tunnel", async () => {
    for (const header of ["cf-ray", "cf-connecting-ip", "x-forwarded-for"]) {
      const res = await promote("sarp-utilities", { headers: { [header]: "1" } });
      assert.equal(res.status, 403);
    }
  });

  test("rejects oversized bodies and other routes", async () => {
    const big = await fetch(`http://127.0.0.1:${PROMOTE_PORT}/promote`, { method: "POST", body: "a".repeat(5000) }).catch(
      () => null,
    );
    assert.ok(big === null || big.status === 413);
    assert.equal((await fetch(`http://127.0.0.1:${PROMOTE_PORT}/promote`)).status, 404);
  });

  test("the promote receiver is not on the public webhook port", async () => {
    assert.ok(!output.includes(`Promote receiver listening on 127.0.0.1:${WEBHOOK_PORT}`));
  });
});

describe("startup", () => {
  test("without a long enough PROMOTE_SECRET the receiver stays off but the webhook runs", async () => {
    server.kill();
    output = "";
    server = await startServer({ WEBHOOK_SECRET, PROMOTE_SECRET: "short" });
    assert.match(output, /promote receiver disabled/);
    const res = await fetch(`http://127.0.0.1:${PROMOTE_PORT}/promote`, { method: "POST" }).catch(() => null);
    assert.equal(res, null);
  });

  test("a busy promote port doesn't take the webhook down", async () => {
    server.kill();
    const http = await import("node:http");
    const blocker = http.createServer().listen(PROMOTE_PORT, "127.0.0.1");
    await new Promise((r) => blocker.once("listening", r));
    try {
      output = "";
      server = await startServer({ WEBHOOK_SECRET, PROMOTE_SECRET });
      await new Promise((r) => setTimeout(r, 200));
      assert.match(output, /Promote receiver disabled: listen EADDRINUSE/);
      assert.equal((await github({}, { event: "ping" })).status, 200);
    } finally {
      blocker.close();
    }
  });
});
