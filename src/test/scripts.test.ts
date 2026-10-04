// Runs deploy-sarp.sh and promote-sarp.sh against throwaway git repos, with
// fake docker/systemctl on PATH. The scripts hard-code /opt/sarp-project, so a
// copy with that path rewritten to a temp dir is executed.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
let tmp: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

/** Creates <tmp>/<name>.git with one commit on main, a clone at <tmp>/root/<name>, and a seed clone for pushing. */
function repo(name: string) {
  const bare = path.join(tmp, `${name}.git`);
  git(tmp, "init", "-q", "--bare", "-b", "main", bare);
  const seed = path.join(tmp, `seed-${name}`);
  git(tmp, "clone", "-q", bare, seed);
  fs.writeFileSync(path.join(seed, "f"), "1\n");
  git(seed, "add", "f");
  git(seed, "commit", "-qm", "init");
  git(seed, "push", "-q", "origin", "HEAD:main");
  git(tmp, "clone", "-q", "-b", "main", "--single-branch", bare, path.join(tmp, "root", name));
  return {
    seed,
    bare,
    commit(branch = "main", msg = "change") {
      git(seed, "checkout", "-q", "-B", branch, "origin/main");
      fs.appendFileSync(path.join(seed, "f"), `${msg}\n`);
      git(seed, "commit", "-qam", msg);
      git(seed, "push", "-q", "origin", `HEAD:${branch}`);
      git(seed, "fetch", "-q", "origin");
    },
    head: (ref = "main") => git(bare, "rev-parse", ref),
  };
}

function script(file: string) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8").split("/opt/sarp-project").join(path.join(tmp, "root"))
    .replace(/\/tmp\/sarp-[a-z-]*deploy\.lock/, path.join(tmp, "deploy.lock"));
  const out = path.join(tmp, path.basename(file));
  fs.writeFileSync(out, src, { mode: 0o755 });
  return out;
}

function run(file: string) {
  const r = spawnSync("bash", [file], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${path.join(tmp, "bin")}:${process.env.PATH}` },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sarp-scripts-"));
  fs.mkdirSync(path.join(tmp, "root"));
  fs.mkdirSync(path.join(tmp, "bin"));
  // Fake docker: logs calls, fails `build` while <tmp>/failbuild exists.
  fs.writeFileSync(
    path.join(tmp, "bin", "docker"),
    `#!/bin/sh\necho "docker $*" >> ${tmp}/calls\n[ "$1" = build ] && [ -f ${tmp}/failbuild ] && exit 1\nexit 0\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(tmp, "bin", "systemctl"), `#!/bin/sh\necho "systemctl $*" >> ${tmp}/calls\n`, { mode: 0o755 });
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const builds = () => (fs.existsSync(path.join(tmp, "calls")) ? fs.readFileSync(path.join(tmp, "calls"), "utf8") : "")
  .split("\n").filter((l) => l.startsWith("docker build")).length;

describe("deploy-sarp.sh", () => {
  test("builds on the first run, then skips when nothing changed", () => {
    repo("sarp-utilities");
    repo("djsko");
    const deploy = script("deploy-sarp.sh");
    assert.equal(run(deploy).code, 0);
    assert.equal(builds(), 1);
    const second = run(deploy);
    assert.match(second.out, /Already deployed/);
    assert.equal(builds(), 1);
  });

  test("rebuilds when either repo gets a new commit", () => {
    const bot = repo("sarp-utilities");
    const djsko = repo("djsko");
    const deploy = script("deploy-sarp.sh");
    run(deploy);
    djsko.commit();
    run(deploy);
    bot.commit();
    run(deploy);
    assert.equal(builds(), 3);
  });

  test("retries a build that failed after pulling", () => {
    const bot = repo("sarp-utilities");
    repo("djsko");
    const deploy = script("deploy-sarp.sh");
    run(deploy);
    bot.commit();
    fs.writeFileSync(path.join(tmp, "failbuild"), "");
    assert.notEqual(run(deploy).code, 0);
    fs.rmSync(path.join(tmp, "failbuild"));
    const retry = run(deploy); // git is already up to date here
    assert.equal(retry.code, 0);
    assert.match(retry.out, /Deploying/);
  });

  test("stashes local edits (content and chmod) instead of failing the pull", () => {
    const bot = repo("sarp-utilities");
    repo("djsko");
    const deploy = script("deploy-sarp.sh");
    run(deploy);
    const f = path.join(tmp, "root", "sarp-utilities", "f");
    fs.appendFileSync(f, "local edit\n");
    fs.chmodSync(f, 0o755);
    bot.commit();
    const r = run(deploy);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Stashing local changes in sarp-utilities/);
    assert.match(git(path.join(tmp, "root", "sarp-utilities"), "stash", "list"), /deploy auto-stash/);
    assert.equal(git(path.join(tmp, "root", "sarp-utilities"), "rev-parse", "HEAD"), bot.head());
  });

  test("restarts the service and runs the migration on deploy", () => {
    repo("sarp-utilities");
    repo("djsko");
    run(script("deploy-sarp.sh"));
    const calls = fs.readFileSync(path.join(tmp, "calls"), "utf8");
    assert.match(calls, /docker run .* npm run db:update/);
    assert.match(calls, /systemctl --user restart sarp-utilities\.service/);
  });
});

describe("deploy-sarp-tickets.sh", () => {
  test("also registers slash commands on deploy", () => {
    repo("sarp-tickets");
    repo("djsko");
    assert.equal(run(script("../sarp-tickets/deploy-sarp-tickets.sh")).code, 0);
    const calls = fs.readFileSync(path.join(tmp, "calls"), "utf8");
    assert.match(calls, /npm run deploy/);
    assert.match(calls, /restart sarp-tickets\.service/);
  });
});

describe("promote-sarp.sh", () => {
  test("fast-forwards main to testing in both repos (server clones only track main)", () => {
    const bot = repo("sarp-utilities");
    const djsko = repo("djsko");
    bot.commit("testing", "feature");
    djsko.commit("testing", "lib");
    const r = run(script("promote-sarp.sh"));
    assert.equal(r.code, 0, r.out);
    assert.equal(bot.head("main"), bot.head("testing"));
    assert.equal(djsko.head("main"), djsko.head("testing"));
  });

  test("refuses to push anything if any repo can't fast-forward", () => {
    const bot = repo("sarp-utilities");
    const djsko = repo("djsko");
    bot.commit("testing", "feature");
    djsko.commit("testing", "lib");
    djsko.commit("main", "hotfix"); // main now has a commit testing lacks
    const mainBefore = bot.head("main");
    const r = run(script("promote-sarp.sh"));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /can't fast-forward/);
    assert.equal(bot.head("main"), mainBefore);
  });
});
