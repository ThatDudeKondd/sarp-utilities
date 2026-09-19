#!/usr/bin/env node
const http = require("http");
const crypto = require("crypto");
const { exec } = require("child_process");

const PORT = 9000;
const SECRET = process.env.WEBHOOK_SECRET;

// Repo full_name -> deploy script. Add a new project here rather than
// standing up a whole second tunnel/receiver/webhook secret for it.
const DEPLOY_SCRIPTS = {
  "ThatDudeKondd/SARP-Utilities": "/opt/sarp-project/sarp-utilities/deploy-sarp.sh",
  "ThatDudeKondd/djsko": "/opt/sarp-project/sarp-utilities/deploy-sarp.sh",
  "ThatDudeKondd/sarp-tickets": "/opt/sarp-project/sarp-tickets/deploy-sarp-tickets.sh",
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
    const deployScript = repoName && DEPLOY_SCRIPTS[repoName];

    if (!deployScript) {
      console.log(`[${new Date().toISOString()}] No deploy script configured for ${repoName}`);
      res.writeHead(200);
      return res.end("Ignored (unconfigured repo)");
    }

    console.log(`[${new Date().toISOString()}] Push to main on ${repoName}, triggering deploy`);
    res.writeHead(200);
    res.end("Deploy triggered");

    exec(deployScript, (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      if (err) console.error(`Deploy script exited with error: ${err.message}`);
    });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Webhook receiver listening on 127.0.0.1:${PORT}`);
});
