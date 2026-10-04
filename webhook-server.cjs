#!/usr/bin/env node
const http = require("http");
const crypto = require("crypto");
const { exec, execFile } = require("child_process");

const PORT = Number(process.env.WEBHOOK_PORT) || 9000;
const SECRET = process.env.WEBHOOK_SECRET;

// Repo full_name -> deploy script(s) to run. Add a new project here rather than
// standing up a whole second tunnel/receiver/webhook secret for it.
const DEPLOY_SCRIPTS = {
  "ThatDudeKondd/SARP-Utilities": ["/opt/sarp-project/sarp-utilities/deploy-sarp.sh"],
  // djsko is a shared dependency of both bots -- redeploy both on a new release.
  "ThatDudeKondd/djsko": [
    "/opt/sarp-project/sarp-utilities/deploy-sarp.sh",
    "/opt/sarp-project/sarp-tickets/deploy-sarp-tickets.sh",
  ],
  "ThatDudeKondd/sarp-tickets": ["/opt/sarp-project/sarp-tickets/deploy-sarp-tickets.sh"],
  "ThatDudeKondd/sarp-tickets-web": ["/opt/sarp-project/sarp-tickets-web/deploy-sarp-tickets-web.sh"],
};

if (!SECRET) {
  console.error("WEBHOOK_SECRET not set, exiting.");
  process.exit(1);
}

function verifySignature(payload, signatureHeader) {
  if (!signatureHeader) return false;
  const hmac = crypto.createHmac("sha256", SECRET);
  const digest = "sha256=" + hmac.update(payload).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404);
    return res.end("Not found");
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    const signature = req.headers["x-hub-signature-256"];

    if (!verifySignature(raw, signature)) {
      console.log(`[${new Date().toISOString()}] Rejected: bad signature`);
      res.writeHead(401);
      return res.end("Invalid signature");
    }

    const event = req.headers["x-github-event"];
    if (event !== "push") {
      res.writeHead(200);
      return res.end("Ignored (not a push event)");
    }

    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      res.writeHead(400);
      return res.end("Bad payload");
    }

    if (payload.ref !== "refs/heads/main") {
      console.log(`[${new Date().toISOString()}] Ignored push to ${payload.ref}`);
      res.writeHead(200);
      return res.end("Ignored (not main branch)");
    }

    const repoName = payload.repository ? payload.repository.full_name : null;
    const deployScripts = repoName && DEPLOY_SCRIPTS[repoName];

    if (!deployScripts) {
      console.log(`[${new Date().toISOString()}] No deploy script configured for ${repoName}`);
      res.writeHead(200);
      return res.end("Ignored (unconfigured repo)");
    }

    console.log(`[${new Date().toISOString()}] Push to main on ${repoName}, triggering deploy`);
    res.writeHead(200);
    res.end("Deploy triggered");

    for (const deployScript of deployScripts) {
      exec(deployScript, (err, stdout, stderr) => {
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
        if (err) console.error(`Deploy script exited with error: ${err.message}`);
      });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Webhook receiver listening on 127.0.0.1:${PORT}`);
});

// ---------------------------------------------------------------------------
// Promote receiver: lets the bots' `jsk promote` (which runs inside their
// Docker containers, with no access to the host's repos) ask the host to
// fast-forward main to testing. The push then fires the normal GitHub webhook
// above, which deploys.
//
// Deliberately a separate port: the Cloudflare tunnel forwards PORT to the
// internet, so anything on it is public. PROMOTE_PORT is loopback-only and
// reachable solely by local processes (the bots run with --network host).
// ---------------------------------------------------------------------------
// Below Linux's ephemeral range (32768+) so outgoing connections never take it.
const PROMOTE_PORT = Number(process.env.PROMOTE_PORT) || 29017;
const PROMOTE_SECRET = process.env.PROMOTE_SECRET ?? "";
const PROMOTE_MAX_SKEW_MS = 60_000;
const PROMOTE_MAX_BODY = 1024;

// Bot name -> script. The request picks a key; it's never part of a command.
const PROMOTE_SCRIPTS = {
  "sarp-utilities": "/opt/sarp-project/sarp-utilities/promote-sarp.sh",
  "sarp-tickets": "/opt/sarp-project/sarp-tickets/promote-sarp-tickets.sh",
};

const usedSignatures = new Map(); // signature -> expiry, blocks replays within the skew window
let promoting = false;

function promoteSignatureValid(timestamp, body, signatureHeader) {
  if (typeof timestamp !== "string" || typeof signatureHeader !== "string") return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", PROMOTE_SECRET).update(`${timestamp}.${body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function promoteReply(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

const promoteServer = http.createServer((req, res) => {
  const log = (msg) => console.log(`[${new Date().toISOString()}] [promote] ${msg}`);

  // Defense in depth: if a tunnel/proxy is ever pointed at this port, refuse.
  if (req.headers["cf-connecting-ip"] || req.headers["cf-ray"] || req.headers["x-forwarded-for"]) {
    log("Rejected: proxied request");
    return promoteReply(res, 403, "Forbidden");
  }
  if (req.method !== "POST" || req.url !== "/promote") {
    return promoteReply(res, 404, "Not found");
  }

  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > PROMOTE_MAX_BODY) {
      promoteReply(res, 413, "Body too large");
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (res.writableEnded) return;
    const body = Buffer.concat(chunks).toString("utf8");
    const timestamp = req.headers["x-promote-timestamp"];
    const signature = req.headers["x-promote-signature"];

    // Signature first: nothing about the body is trusted (or even parsed) before this.
    if (!promoteSignatureValid(timestamp, body, signature)) {
      log("Rejected: bad signature");
      return promoteReply(res, 401, "Invalid signature");
    }
    if (!/^\d{10,16}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > PROMOTE_MAX_SKEW_MS) {
      log("Rejected: stale timestamp");
      return promoteReply(res, 401, "Stale request");
    }
    const now = Date.now();
    for (const [sig, expiry] of usedSignatures) if (expiry < now) usedSignatures.delete(sig);
    if (usedSignatures.has(signature)) {
      log("Rejected: replayed request");
      return promoteReply(res, 401, "Replayed request");
    }
    usedSignatures.set(signature, now + 2 * PROMOTE_MAX_SKEW_MS);

    let bot;
    try {
      bot = JSON.parse(body).bot;
    } catch {
      return promoteReply(res, 400, "Bad payload");
    }
    const script = Object.hasOwn(PROMOTE_SCRIPTS, bot) ? PROMOTE_SCRIPTS[bot] : null;
    if (!script) return promoteReply(res, 400, "Unknown bot");

    if (promoting) return promoteReply(res, 409, "A promote is already running");
    promoting = true;
    log(`Promoting ${bot}`);

    // execFile, no shell: the mapped path is the only thing executed.
    execFile(script, [], { timeout: 120_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      promoting = false;
      const output = `${stdout}${stderr}`.trim().slice(-1500);
      if (err) {
        log(`Promote of ${bot} failed: ${err.message}\n${output}`);
        return promoteReply(res, 500, output || err.message);
      }
      log(`Promoted ${bot}\n${output}`);
      promoteReply(res, 200, output || "Promoted.");
    });
  });
});

// A busy port must never crash the process: that would take the GitHub
// deploy webhook on PORT down with it.
promoteServer.on("error", (err) => {
  console.error(`Promote receiver disabled: ${err.message}`);
});

if (PROMOTE_SECRET.length >= 32) {
  promoteServer.listen(PROMOTE_PORT, "127.0.0.1", () => {
    console.log(`Promote receiver listening on 127.0.0.1:${PROMOTE_PORT}`);
  });
} else {
  console.log("PROMOTE_SECRET unset or shorter than 32 chars -- promote receiver disabled.");
}
