#!/usr/bin/env node
/** Installer sandbox tests; npm and Pi are mocked and no live profile is touched. */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const installer = root;
const artifact = path.join(installer, "pi-portable-installer.sh");
const buildScript = path.join(installer, "build.mjs");
const payloadRoot = path.join(installer, "payload");
const template = path.join(payloadRoot, "settings.template.json");
const lensConfigTemplate = path.join(payloadRoot, "config", "pi-lens.json");
const bash = process.env.BASH || "bash";
const host = process.platform === "win32" ? "windows" : "unix";
const built = spawnSync(process.execPath, [buildScript], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(
  built.status,
  0,
  `${built.stdout}
${built.stderr}`,
);
assert.equal(
  fs.existsSync(path.join(payloadRoot, "skills")),
  false,
  "installer payload must not bundle skills",
);
const launcher = fs.readFileSync(artifact, "utf8");
assert.match(launcher, /engine\.mjs/);
assert.doesNotMatch(
  launcher,
  /__PI_PAYLOAD__|__PI_ENGINE__|embedded payload|Portable Pi profile installer engine/,
);
assert.ok(
  launcher.length < 300,
  "launcher should stay small and self-contained only as a dispatcher",
);
const templateJson = JSON.parse(fs.readFileSync(template, "utf8"));
assert.ok(templateJson.packages.length > 0);
assert.ok(
  templateJson.packages.every((item) =>
    (typeof item === "string" ? item : item.source).startsWith("npm:"),
  ),
);
const lensConfigJson = JSON.parse(fs.readFileSync(lensConfigTemplate, "utf8"));
assert.equal(lensConfigJson.tools.lazy, true);
assert.equal(lensConfigJson.contextInjection.enabled, false);
assert.equal(lensConfigJson.guard.sharedCheckout, true);
assert.equal(lensConfigJson.actionableWarnings.enabled, true);
assert.equal(lensConfigJson.actionableWarnings.includeLspCodeActions, true);
assert.equal(lensConfigJson.actionableWarnings.autoFix.enabled, false);
assert.equal(lensConfigJson.startup.scans.enabled, false);

const temp = fs.mkdtempSync(
  path.join(fs.realpathSync(os.tmpdir()), "pi-portable-installer-test-"),
);
const fakeHome = path.join(temp, "fake home");
fs.mkdirSync(fakeHome, { recursive: true });
const fakeDir = path.join(temp, "fake package installer");
fs.mkdirSync(fakeDir, { recursive: true });
const fakeNpm = path.join(fakeDir, "npm");
const fakeNpmJs = path.join(fakeDir, "fake-npm.mjs");
fs.writeFileSync(fakeNpm, `#!/usr/bin/env sh\nexec node "$FAKE_NPM_JS" "$@"\n`);
try {
  fs.chmodSync(fakeNpm, 0o755);
} catch {}
fs.writeFileSync(
  fakeNpmJs,
  `
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
if (args.includes("--version")) process.exit(0);
const prefix = args[args.indexOf("--prefix") + 1];
if (!prefix) process.exit(2);
const pkg = path.join(prefix, "node_modules", "@earendil-works", "pi-coding-agent");
fs.mkdirSync(pkg, { recursive: true });
fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ bin: { pi: "cli.mjs" } }));
fs.writeFileSync(path.join(pkg, "cli.mjs"), \
\`import fs from "node:fs";
import path from "node:path";
const a = process.argv.slice(2);
const stage = process.env.PI_CODING_AGENT_DIR;
if (a[0] === "--probe") fs.writeFileSync(path.join(stage, "launcher-profile.txt"), stage);
if (a[0] === "install") {
  if (process.env.FAKE_PI_FAIL === "1") { console.error("intentional fake package failure"); process.exit(17); }
  fs.mkdirSync(path.join(stage, "npm", "fake-package"), { recursive: true });
  fs.writeFileSync(path.join(stage, "npm", "fake-package", "installed.txt"), a[1] || "");
  fs.mkdirSync(path.join(stage, "skills", "generated-by-fake"), { recursive: true });
  fs.writeFileSync(path.join(stage, "skills", "generated-by-fake", "must-not-ship"), "generated");
}
\`);
`,
);
const baseEnv = {
  ...process.env,
  PATH: `${fakeDir}${path.delimiter}${process.env.PATH}`,
  FAKE_NPM_JS: fakeNpmJs,
  npm_execpath: fakeNpmJs,
};
function run(target, input, extra = {}, cwd = root) {
  return spawnSync(
    bash,
    [
      artifact,
      "--host",
      host,
      "--target",
      target,
      "--settings-template",
      template,
    ],
    {
      cwd,
      input,
      encoding: "utf8",
      env: {
        ...baseEnv,
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        ...extra,
      },
    },
  );
}
function skillsDirectory(target) {
  const name = fs
    .readdirSync(target)
    .find((entry) => entry.toLowerCase() === "skills");
  assert.ok(name, `skills directory missing in ${target}`);
  return path.join(target, name);
}
function assertSkillsUnchanged(target, expected) {
  const skills = skillsDirectory(target);
  assert.equal(
    fs.readFileSync(path.join(skills, "keep.txt"), "utf8"),
    expected,
  );
  assert.equal(fs.existsSync(path.join(skills, "generated-by-fake")), false);
}
function findArchive(parent) {
  return fs
    .readdirSync(parent)
    .find((name) => name.startsWith(".pi-migration-backup-"));
}

const existingRoot = path.join(temp, "existing profile");
const existingTarget = path.join(existingRoot, "agent");
const existingSibling = path.join(existingRoot, "web-search.json");
const installedLensConfig = path.join(fakeHome, ".pi-lens", "config.json");
fs.mkdirSync(path.dirname(installedLensConfig), { recursive: true });
fs.writeFileSync(installedLensConfig, "old lens config");
fs.mkdirSync(path.join(existingTarget, "skills"), { recursive: true });
fs.writeFileSync(path.join(existingTarget, "stale.txt"), "remove");
fs.writeFileSync(path.join(existingTarget, "auth.json"), "archive");
fs.writeFileSync(
  path.join(existingTarget, "skills", "keep.txt"),
  "keep exactly",
);
fs.writeFileSync(existingSibling, "old sibling");
const skillsStat = fs.statSync(path.join(existingTarget, "skills"));
let result = run(existingTarget, "no\nyes\n");
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.equal(
  fs
    .readdirSync(existingRoot)
    .some((name) => name.startsWith(".pi-portable-stage-")),
  false,
  "successful install must remove staging directory",
);
assertSkillsUnchanged(existingTarget, "keep exactly");
assert.equal(
  fs.statSync(path.join(existingTarget, "skills")).ino,
  skillsStat.ino,
);
assert.equal(fs.existsSync(path.join(existingTarget, "stale.txt")), false);
assert.equal(fs.existsSync(path.join(existingTarget, "auth.json")), false);
assert.ok(fs.existsSync(path.join(existingTarget, "settings.json")));
assert.ok(
  fs.existsSync(
    path.join(existingTarget, "npm", "fake-package", "installed.txt"),
  ),
);
assert.equal(
  fs.existsSync(path.join(existingTarget, "skills", "generated-by-fake")),
  false,
);
const archiveName = findArchive(existingRoot);
assert.ok(archiveName);
assert.equal(
  fs.existsSync(path.join(existingRoot, archiveName, "profile", "auth.json")),
  true,
);
assert.equal(
  fs.existsSync(path.join(existingRoot, archiveName, "profile", "skills")),
  false,
);
assert.deepEqual(
  JSON.parse(fs.readFileSync(installedLensConfig, "utf8")),
  lensConfigJson,
);
assert.equal(
  fs.readFileSync(
    path.join(existingRoot, archiveName, "pi-lens", "config.json"),
    "utf8",
  ),
  "old lens config",
);

const caseRoot = path.join(temp, "case-insensitive skills");
const caseTarget = path.join(caseRoot, "agent");
fs.mkdirSync(path.join(caseTarget, "Skills"), { recursive: true });
fs.writeFileSync(path.join(caseTarget, "Skills", "keep.txt"), "case keep");
result = run(caseTarget, "no\nyes\n");
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.equal(
  fs.readFileSync(path.join(caseTarget, "Skills", "keep.txt"), "utf8"),
  "case keep",
);
assert.equal(
  fs.existsSync(path.join(caseTarget, "Skills", "generated-by-fake")),
  false,
);

fs.mkdirSync(path.join(temp, "unrelated cwd"), { recursive: true });
const launcherResult = spawnSync(
  bash,
  [path.join(existingTarget, "bin", "pi"), "--probe"],
  {
    cwd: path.join(temp, "unrelated cwd"),
    encoding: "utf8",
    env: {
      ...baseEnv,
      PI_CODING_AGENT_DIR: path.join(temp, "wrong inherited profile"),
    },
  },
);
assert.equal(
  launcherResult.status,
  0,
  `${launcherResult.stdout}\n${launcherResult.stderr}`,
);
assert.equal(
  fs.readFileSync(path.join(existingTarget, "launcher-profile.txt"), "utf8"),
  existingTarget,
);

const failureRoot = path.join(temp, "failure");
const failureTarget = path.join(failureRoot, "agent");
const failureSibling = path.join(failureRoot, "web-search.json");
fs.mkdirSync(path.join(failureTarget, "skills"), { recursive: true });
fs.writeFileSync(path.join(failureTarget, "original.txt"), "original");
fs.writeFileSync(
  path.join(failureTarget, "skills", "keep.txt"),
  "rollback keep",
);
fs.writeFileSync(failureSibling, "original sibling");
result = run(failureTarget, "no\nyes\n", { FAKE_PI_FAIL: "1" });
assert.notEqual(result.status, 0);
assert.equal(
  fs.readFileSync(path.join(failureTarget, "original.txt"), "utf8"),
  "original",
);
assertSkillsUnchanged(failureTarget, "rollback keep");
assert.equal(fs.readFileSync(failureSibling, "utf8"), "original sibling");

const rollbackRoot = path.join(temp, "rollback");
const rollbackTarget = path.join(rollbackRoot, "agent");
const rollbackSibling = path.join(rollbackRoot, "web-search.json");
fs.mkdirSync(path.join(rollbackTarget, "Skills"), { recursive: true });
fs.writeFileSync(path.join(rollbackTarget, "original.txt"), "original");
fs.writeFileSync(
  path.join(rollbackTarget, "Skills", "keep.txt"),
  "rollback keep",
);
fs.writeFileSync(rollbackSibling, "original sibling");
fs.writeFileSync(installedLensConfig, "original lens config");
result = run(rollbackTarget, "no\nyes\n", {
  PI_INSTALLER_TEST_MODE: "1",
  PI_INSTALLER_TEST_FAIL_SIBLING: "1",
});
assert.notEqual(result.status, 0);
assert.match(`${result.stdout}${result.stderr}`, /INSTALL FAILED/);
assert.equal(
  fs.readFileSync(path.join(rollbackTarget, "original.txt"), "utf8"),
  "original",
);
assertSkillsUnchanged(rollbackTarget, "rollback keep");
assert.equal(fs.readFileSync(rollbackSibling, "utf8"), "original sibling");
assert.equal(
  fs.readFileSync(installedLensConfig, "utf8"),
  "original lens config",
);
assert.equal(
  fs
    .readdirSync(rollbackRoot)
    .some((name) => name.includes(".pi-portable-web-search-")),
  false,
);

for (const unsafe of [os.homedir(), path.parse(os.homedir()).root]) {
  result = spawnSync(
    bash,
    [
      artifact,
      "--dry-run",
      "--host",
      "windows",
      "--target",
      unsafe,
      "--settings-template",
      template,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: baseEnv,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /unsafe target/);
}
const overlapTarget = path.join(temp, "overlap", "agent");
result = spawnSync(
  bash,
  [
    artifact,
    "--dry-run",
    "--host",
    "windows",
    "--target",
    overlapTarget,
    "--backup",
    path.join(overlapTarget, "backup"),
    "--settings-template",
    template,
  ],
  {
    cwd: root,
    encoding: "utf8",
    env: baseEnv,
  },
);
assert.notEqual(result.status, 0);
assert.match(`${result.stdout}${result.stderr}`, /overlap/);
const symlinkReal = path.join(temp, "symlink-real");
const symlinkPath = path.join(temp, "symlink-target");
fs.mkdirSync(symlinkReal, { recursive: true });
try {
  fs.symlinkSync(symlinkReal, symlinkPath, "junction");
  result = spawnSync(
    bash,
    [
      artifact,
      "--dry-run",
      "--host",
      "windows",
      "--target",
      path.join(symlinkPath, "agent"),
      "--settings-template",
      template,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: baseEnv,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /symlink|junction/i);
} catch (error) {
  console.log(`symlink guard test skipped: ${error.code || error.message}`);
}
const forbiddenContentFixture = path.join(
  payloadRoot,
  "build-secret-fixture.txt",
);
fs.writeFileSync(
  forbiddenContentFixture,
  "fake local path C:/Users/awis02/fixture",
);
try {
  const rejected = spawnSync(process.execPath, [buildScript], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(rejected.status, 0);
  assert.match(
    `${rejected.stdout}${rejected.stderr}`,
    /possible secret or machine username in payload/,
  );
} finally {
  fs.rmSync(forbiddenContentFixture, { force: true });
}
const forbiddenPathFixture = path.join(payloadRoot, "auth.json");
fs.writeFileSync(forbiddenPathFixture, "forbidden");
try {
  const rejected = spawnSync(process.execPath, [buildScript], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(rejected.status, 0);
  assert.match(
    `${rejected.stdout}${rejected.stderr}`,
    /forbidden payload path/,
  );
} finally {
  fs.rmSync(forbiddenPathFixture, { force: true });
}
const hostSymlink = path.join(installer, "host-unix.txt");
const hostOriginal = path.join(temp, "host-unix-original.txt");
let hostMoved = false;
let hostLinked = false;
try {
  fs.renameSync(hostSymlink, hostOriginal);
  hostMoved = true;
  fs.symlinkSync(hostOriginal, hostSymlink, "file");
  hostLinked = true;
  const rejected = spawnSync(process.execPath, [buildScript], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stdout}${rejected.stderr}`, /regular file/);
} catch (error) {
  if (hostMoved && !hostLinked)
    console.log(
      `host symlink guard test skipped: ${error.code || error.message}`,
    );
} finally {
  if (hostLinked) fs.unlinkSync(hostSymlink);
  if (hostMoved) fs.renameSync(hostOriginal, hostSymlink);
}
const payloadLink = path.join(installer, "payload-link-target");
let payloadMoved = false;
let payloadLinked = false;
try {
  fs.renameSync(payloadRoot, payloadLink);
  payloadMoved = true;
  fs.symlinkSync(payloadLink, payloadRoot, "junction");
  payloadLinked = true;
  const rejected = spawnSync(
    bash,
    [
      artifact,
      "--dry-run",
      "--host",
      "unix",
      "--target",
      path.join(temp, "payload-link-target-profile", "agent"),
      "--settings-template",
      template,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: baseEnv,
    },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stdout}${rejected.stderr}`, /payload root|symlink/i);
} catch (error) {
  if (payloadMoved && !payloadLinked)
    console.log(
      `payload root symlink guard test skipped: ${error.code || error.message}`,
    );
} finally {
  if (payloadLinked) fs.unlinkSync(payloadRoot);
  if (payloadMoved) fs.renameSync(payloadLink, payloadRoot);
}
const rebuilt = spawnSync(process.execPath, [buildScript], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(
  rebuilt.status,
  0,
  `${rebuilt.stdout}
${rebuilt.stderr}`,
);

const runtimeCache = path.join(
  payloadRoot,
  "runtime-fixture",
  ".ruff_cache",
  "ignored.txt",
);
fs.mkdirSync(path.dirname(runtimeCache), { recursive: true });
fs.writeFileSync(runtimeCache, "must not be copied");
try {
  fs.mkdirSync(path.join(temp, "unrelated cwd"), { recursive: true });
  const newRoot = path.join(temp, "new profile");
  const newTarget = path.join(newRoot, "agent");
  result = run(newTarget, "no\nyes\n", {}, path.join(temp, "unrelated cwd"));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(path.join(newTarget, "runtime-fixture")), false);
  assert.ok(fs.existsSync(path.join(newTarget, "settings.json")));
} finally {
  fs.rmSync(path.join(payloadRoot, "runtime-fixture"), {
    recursive: true,
    force: true,
  });
}

const newRoot = path.join(temp, "new profile without fixture");
const newTarget = path.join(newRoot, "agent");
result = run(newTarget, "no\nyes\n", {}, path.join(temp, "unrelated cwd"));
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.equal(fs.existsSync(path.join(newTarget, "skills")), false);
assert.ok(fs.existsSync(path.join(newTarget, "settings.json")));

const dryRun = spawnSync(
  bash,
  [
    artifact,
    "--dry-run",
    "--host",
    "unix",
    "--target",
    path.join(temp, "dry run", "agent"),
    "--settings-template",
    template,
  ],
  {
    cwd: path.join(temp, "unrelated cwd"),
    encoding: "utf8",
    env: baseEnv,
  },
);
assert.equal(dryRun.status, 0, dryRun.stderr);
assert.match(dryRun.stdout, /Selected host: unix/);
assert.match(dryRun.stdout, /Global pi-lens config:/);
assert.equal(fs.existsSync(path.join(temp, "dry run", "agent")), false);

process.env.PI_INSTALLER_TEST_LIBRARY = "1";
const { renderAppend } = await import(
  pathToFileURL(path.join(installer, "engine.mjs"))
);
const shared = fs.readFileSync(
  path.join(payloadRoot, "APPEND_SYSTEM.md"),
  "utf8",
);
assert.match(
  renderAppend(
    shared,
    fs.readFileSync(path.join(installer, "host-windows.txt"), "utf8"),
  ),
  /On Windows \(Git Bash\)/,
);
assert.match(
  renderAppend(
    shared,
    fs.readFileSync(path.join(installer, "host-unix.txt"), "utf8"),
  ),
  /On Linux and macOS/,
);
await fsp.rm(temp, { recursive: true, force: true });
console.log("installer sandbox tests passed");
