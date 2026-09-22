#!/usr/bin/env node
/** Portable Pi profile installer engine. Uses only Node's standard library. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const MIN_NODE = [22, 19, 0];
const installerRoot = path.dirname(fileURLToPath(import.meta.url));
const payloadRoot = path.join(installerRoot, "payload");
function isSkillsName(name) {
  return name.toLowerCase() === "skills";
}
const PROFILE_FILES = [
  "settings.json",
  "APPEND_SYSTEM.md",
  "mcp.json",
  "web-search.json",
  "extensions/**",
  "bin/**",
];
const forbiddenResource =
  /(^|[/\\])(auth\.json|trust\.json|models-store\.json|subagents\.json|run-history|sessions|mcp-cache|mcp-onboarding|node_modules|friday\.md|rtk(?:[-.]|$)|herdr(?:[-.]|$)|orca(?:[-.]|$)|quotas?\.json|zentui(?:\.json|$)|pi-permission-system)([/\\]|$)/i;
const forbiddenContent =
  /awis02|BEGIN (?:RSA|OPENSSH|EC|PRIVATE)|sk-[A-Za-z0-9]{16,}/;
const excludedDirectoryNames = new Set([
  ".ruff_cache",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
]);

function usage() {
  console.log(`Portable Pi profile installer

Usage: pi-portable-installer.sh [options]

Options:
  --target PATH              managed profile (default: PI_CODING_AGENT_DIR or ~/.pi/agent)
  --settings-template PATH   approved complete settings template (never merged)
  --host windows|unix        selected host family (otherwise prompted; detected host is suggested)
  --backup PATH              archive directory (default: target sibling)
  --dry-run                  validate and print the exact plan; never prompt or write
  --help                     show this help

The installer does not accept --yes/--assume-yes: a real confirmation is required.
Existing managed profile and its sibling web-search.json are archived outside the
profile, then replaced with a clean allowlist. Credentials, sessions, history and
caches are never copied. Authentication must be repeated.
`);
}
function fail(message) {
  throw new Error(message);
}
function norm(p) {
  return path
    .resolve(p)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}
function isWithin(parent, child) {
  const a = norm(parent);
  const b = norm(child);
  return b === a || b.startsWith(`${a}${path.sep}`);
}
function overlap(a, b) {
  return isWithin(a, b) || isWithin(b, a);
}
function display(p) {
  return process.platform === "win32" ? p.replaceAll("\\", "/") : p;
}
function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/"))
    return path.join(os.homedir(), value.slice(2));
  return value;
}
function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--yes" || arg === "--assume-yes" || arg === "-y")
      fail(
        `${arg} is intentionally unsupported; explicit confirmation is required`,
      );
    const takes = {
      "--target": "target",
      "--settings-template": "settingsTemplate",
      "--host": "host",
      "--backup": "backup",
    };
    if (takes[arg]) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        fail(`${arg} requires a value`);
      out[takes[arg]] = argv[++i];
      continue;
    }
    fail(`unknown option: ${arg}`);
  }
  return out;
}
let inputInterface;
let pendingAnswer;
let pipedAnswers;
function askAnswer(prompt) {
  if (!process.stdin.isTTY) {
    process.stdout.write(prompt);
    if (pipedAnswers === undefined) {
      const input = fs.readFileSync(0, "utf8");
      pipedAnswers = input ? input.split(/\r?\n/) : [];
      if (input.endsWith("\n")) pipedAnswers.pop();
    }
    const answer = pipedAnswers.shift();
    return Promise.resolve({
      answer: (answer || "").trim(),
      eof: answer === undefined,
    });
  }
  if (!inputInterface) {
    inputInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    inputInterface.on("close", () => {
      const resolve = pendingAnswer;
      pendingAnswer = undefined;
      resolve?.({ answer: "", eof: true });
    });
  }
  return new Promise((resolve) => {
    pendingAnswer = resolve;
    inputInterface.question(prompt, (answer) => {
      pendingAnswer = undefined;
      resolve({ answer: answer.trim(), eof: false });
    });
  });
}
function ask(prompt) {
  return askAnswer(prompt).then(({ answer }) => answer);
}
function closeInput() {
  inputInterface?.close();
  inputInterface = undefined;
  pendingAnswer = undefined;
  pipedAnswers = undefined;
}
function detectedHost() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux" || process.platform === "darwin")
    return "unix";
  return null;
}
export async function chooseHost(opts) {
  const detected = detectedHost();
  if (!detected) fail(`unsupported execution platform: ${process.platform}`);
  if (opts.host && !["windows", "unix"].includes(opts.host))
    fail(`--host must be windows or unix, got ${opts.host}`);
  let host = opts.host;
  if (!host) {
    host = opts.dryRun
      ? detected
      : (await ask(
          `Detected host: ${detected}. Select host family [windows|unix] (Enter accepts ${detected}): `,
        )) || detected;
  }
  if (!["windows", "unix"].includes(host))
    fail(`invalid host selection: ${host}`);
  if (!opts.dryRun && host !== detected)
    fail(
      `selected host ${host} does not match execution host ${detected}; refusing real installation`,
    );
  return host;
}
export function renderAppend(shared, hostText) {
  const start = shared.indexOf("# Environment and tool use");
  const end = shared.indexOf("## Local orchestration policy", start);
  if (start < 0 || end < 0)
    fail(
      "APPEND_SYSTEM.md is missing the expected Environment/Local orchestration sections",
    );
  return `${shared.slice(0, start)}# Environment and tool use\n\n${hostText.trim()}\n\n${shared.slice(end)}`;
}
function version(raw) {
  const m = String(raw).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function atLeast(actual, wanted) {
  return (
    actual &&
    (actual[0] > wanted[0] ||
      (actual[0] === wanted[0] &&
        (actual[1] > wanted[1] ||
          (actual[1] === wanted[1] && actual[2] >= wanted[2]))))
  );
}
function nodeCheck() {
  const actual = version(process.versions.node);
  if (!atLeast(actual, MIN_NODE))
    fail(
      `Node ${MIN_NODE.join(".")} or newer is required (found ${process.versions.node})`,
    );
}
function commandVersion(command, args) {
  const r = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error || r.status !== 0) return null;
  return { raw: `${r.stdout || ""}\n${r.stderr || ""}`, status: r.status };
}
function npmInvocation() {
  const configured =
    process.env.npm_execpath && path.resolve(process.env.npm_execpath);
  const bundled = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (
    configured &&
    fs.existsSync(configured) &&
    /\.(?:c?m?js)$/.test(configured)
  )
    return { command: process.execPath, prefix: [configured] };
  if (fs.existsSync(bundled))
    return { command: process.execPath, prefix: [bundled] };
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    prefix: [],
  };
}
function checkNpm() {
  const invocation = npmInvocation();
  if (!commandVersion(invocation.command, [...invocation.prefix, "--version"]))
    fail(
      "npm is required but could not be executed; install npm alongside Node.js before retrying",
    );
  return invocation;
}
function rejectSymlinkComponents(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const rest = absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  for (const part of rest) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        fail(`unsafe path: symlink/junction component: ${display(current)}`);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
function validatePaths(opts) {
  const home = path.resolve(os.homedir());
  const target = path.resolve(
    expandHome(
      opts.target ||
        process.env.PI_CODING_AGENT_DIR ||
        path.join(home, ".pi", "agent"),
    ),
  );
  if (
    [path.parse(target).root, home, path.join(home, ".pi")].some(
      (p) => norm(target) === norm(p),
    )
  )
    fail(
      `unsafe target: refusing filesystem root, home, or home/.pi itself: ${display(target)}`,
    );
  rejectSymlinkComponents(target);
  const parent = path.dirname(target);
  rejectSymlinkComponents(parent);
  if (fs.existsSync(target) && !fs.statSync(target).isDirectory())
    fail(`unsafe target: expected a directory: ${display(target)}`);
  if (fs.existsSync(target)) {
    const skills = fs
      .readdirSync(target, { withFileTypes: true })
      .find((entry) => isSkillsName(entry.name));
    if (skills && fs.lstatSync(path.join(target, skills.name)).isSymbolicLink())
      fail(
        `unsafe path: symlink/junction component: ${display(path.join(target, skills.name))}`,
      );
  }
  const sibling = path.join(parent, "web-search.json");
  if (fs.existsSync(sibling)) rejectSymlinkComponents(sibling);
  const lensDir = path.join(home, ".pi-lens");
  const lensConfig = path.join(lensDir, "config.json");
  rejectSymlinkComponents(lensConfig);
  if (fs.existsSync(lensConfig) && !fs.statSync(lensConfig).isFile())
    fail(
      `unsafe pi-lens config path: expected a file: ${display(lensConfig)}`,
    );
  const backup = path.resolve(
    expandHome(
      opts.backup ||
        path.join(
          parent,
          `.pi-migration-backup-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
        ),
    ),
  );
  if (fs.existsSync(backup))
    fail(
      `backup path already exists; choose a new --backup path: ${display(backup)}`,
    );
  rejectSymlinkComponents(path.dirname(backup));
  if (overlap(installerRoot, target) || overlap(installerRoot, backup))
    fail("unsafe overlap: source and target/backup overlap");
  if (overlap(target, backup))
    fail("unsafe overlap: target and backup overlap");
  if (overlap(target, sibling) || overlap(backup, sibling))
    fail("unsafe overlap: sibling path overlaps target or backup");
  if (
    overlap(target, lensConfig) ||
    overlap(backup, lensConfig) ||
    overlap(sibling, lensConfig)
  )
    fail("unsafe overlap: pi-lens config overlaps managed paths");
  return {
    home,
    target,
    parent,
    sibling,
    lensDir,
    lensConfig,
    backup,
    source: installerRoot,
  };
}
function recursivelyRender(value, context, parentKey = "") {
  if (Array.isArray(value))
    return value
      .map((v) => recursivelyRender(v, context, parentKey))
      .filter((v) => v !== null && v !== undefined);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const rendered = recursivelyRender(item, context, key);
      if (rendered !== null && rendered !== undefined) result[key] = rendered;
    }
    return result;
  }
  if (typeof value !== "string") return value;
  if (
    parentKey === "subagentOnlyExtensions" &&
    value.startsWith("npm/node_modules/")
  )
    value = `{{PROFILE}}/${value}`;
  if (value === "{{WINDOWS_BASH_PATH}}")
    return context.windows ? context.windowsBash : null;
  if (value.startsWith("{{WINDOWS_PATH:") && value.endsWith("}}"))
    return context.windows ? value.slice(15, -2) : null;
  return value
    .replaceAll("{{HOME}}", display(context.home))
    .replaceAll("{{PROFILE}}", display(context.profile));
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(`invalid JSON template ${display(file)}: ${e.message}`);
  }
}
function settingsFor(opts, files, paths, host) {
  let raw;
  if (opts.settingsTemplate)
    raw = readJson(path.resolve(expandHome(opts.settingsTemplate)));
  else {
    try {
      raw = JSON.parse(files["settings.template.json"].toString("utf8"));
    } catch (e) {
      fail(`invalid local settings template: ${e.message}`);
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    fail("settings template must contain a JSON object");
  const windowsBash =
    process.platform === "win32" &&
    [
      "C:/Program Files/Git/bin/bash.exe",
      "C:/Program Files/Git/usr/bin/bash.exe",
    ]
      .map((p) => p.replaceAll("/", path.sep))
      .find(fs.existsSync);
  const rendered = recursivelyRender(raw, {
    home: paths.home,
    profile: paths.target,
    windows: host === "windows",
    windowsBash: windowsBash ? display(windowsBash) : "bash.exe",
  });
  if (
    host === "unix" &&
    typeof rendered.shellPath === "string" &&
    /^[A-Za-z]:[\\/]/.test(rendered.shellPath)
  )
    delete rendered.shellPath;
  const packages = Array.isArray(rendered.packages) ? rendered.packages : [];
  if (
    packages.some((item) => {
      const source = typeof item === "string" ? item : item && item.source;
      return typeof source !== "string" || !source.startsWith("npm:");
    })
  )
    fail("settings template packages must use npm: sources");
  if (!packages.length)
    fail(
      "settings template must specify the approved npm packages; refusing an empty package set",
    );
  rendered.packages = packages;
  return { settings: rendered, packages };
}
function filesUnder(dir) {
  if (!fs.existsSync(dir))
    fail(`local payload directory is missing: ${display(dir)}`);
  if (!fs.lstatSync(dir).isDirectory())
    fail(`local payload root is not a directory: ${display(dir)}`);
  const result = {};
  const walk = (current, relative = "") => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (forbiddenResource.test(name))
        fail(`forbidden local payload path: ${name}`);
      if (entry.isDirectory()) {
        if (!excludedDirectoryNames.has(entry.name)) walk(full, name);
      } else if (entry.isFile()) {
        const data = fs.readFileSync(full);
        if (forbiddenContent.test(data.toString("utf8")))
          fail(`possible secret or machine username in local payload: ${name}`);
        result[name] = data;
      } else
        fail(
          `local payload contains unsupported filesystem entry: ${display(full)}`,
        );
    }
  };
  walk(dir);
  for (const host of ["windows", "unix"]) {
    const file = path.join(installerRoot, `host-${host}.txt`);
    if (!fs.lstatSync(file).isFile())
      fail(`local host template is missing: ${display(file)}`);
    const data = fs.readFileSync(file);
    if (forbiddenContent.test(data.toString("utf8")))
      fail(`possible secret or machine username in host template: ${host}`);
    result[`__host-${host}.txt`] = data;
  }
  return result;
}
function payloadText(files, name) {
  if (!files[name]) fail(`local payload is missing ${name}`);
  return files[name].toString("utf8");
}
async function writePayload(stage, files, settings, host) {
  for (const [name, data] of Object.entries(files)) {
    if (
      name === "settings.template.json" ||
      name === "README.md" ||
      name.startsWith("config/") ||
      name.startsWith("__host-") ||
      name === "skills" ||
      name.startsWith("skills/")
    )
      continue;
    const out = path.join(stage, name);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, data);
  }
  await fsp.writeFile(
    path.join(stage, "mcp.json"),
    payloadText(files, "config/mcp.json"),
  );
  const hostPrompt = payloadText(
    files,
    host === "windows" ? "__host-windows.txt" : "__host-unix.txt",
  );
  await fsp.writeFile(
    path.join(stage, "APPEND_SYSTEM.md"),
    renderAppend(payloadText(files, "APPEND_SYSTEM.md"), hostPrompt),
  );
  await fsp.writeFile(
    path.join(stage, "settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}
function packageSource(item) {
  return typeof item === "string" ? item : item.source;
}
function piScript(runtime) {
  const pkg = path.join(
    runtime,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "package.json",
  );
  const metadata = readJson(pkg);
  const bin =
    typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.pi;
  if (!bin) fail("installed Pi package does not expose the pi CLI");
  return path.resolve(path.dirname(pkg), bin);
}
function runPi(runtime, stage, args) {
  const script = piScript(runtime);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: stage,
    env: { ...process.env, PI_CODING_AGENT_DIR: stage },
    stdio: "inherit",
  });
  if (result.error || result.status !== 0)
    fail(
      `Pi package operation failed${result.error ? `: ${result.error.message}` : ` (exit ${result.status})`}`,
    );
}
async function installStage(stage, settings) {
  const runtime = path.join(stage, ".pi-runtime");
  const npm = npmInvocation();
  const result = spawnSync(
    npm.command,
    [
      ...npm.prefix,
      "install",
      "--prefix",
      runtime,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "@earendil-works/pi-coding-agent@latest",
    ],
    { cwd: stage, env: process.env, stdio: "inherit" },
  );
  if (result.error || result.status !== 0)
    fail(
      `Pi npm installation failed${result.error ? `: ${result.error.message}` : ` (exit ${result.status})`}`,
    );
  for (const item of settings.packages)
    runPi(runtime, stage, ["install", packageSource(item)]);
  await fsp.writeFile(
    path.join(stage, "settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
  const bin = path.join(stage, "bin");
  await fsp.mkdir(bin, { recursive: true });
  const cli = piScript(runtime);
  const cliRelative = path
    .relative(
      path.dirname(
        path.join(
          runtime,
          "node_modules/@earendil-works/pi-coding-agent/package.json",
        ),
      ),
      cli,
    )
    .replaceAll("\\", "/");
  const launcher = `#!/usr/bin/env sh\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nPROFILE=$(CDPATH= cd -- "$HERE/.." && pwd)\ncase "$(uname -s 2>/dev/null || true)" in MINGW*|MSYS*|CYGWIN*) command -v cygpath >/dev/null 2>&1 && PROFILE=$(cygpath -w "$PROFILE");; esac\nexport PI_CODING_AGENT_DIR="$PROFILE"\nexport PATH="$HERE:$PATH"\nexec ${JSON.stringify(process.execPath)} "$HERE/../.pi-runtime/node_modules/@earendil-works/pi-coding-agent/${cliRelative}" "$@"\n`;
  await fsp.writeFile(path.join(bin, "pi"), launcher, { mode: 0o755 });
  const cliWindows = path
    .relative(
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent"),
      cli,
    )
    .replaceAll("/", "\\");
  await fsp.writeFile(
    path.join(bin, "pi.cmd"),
    `@echo off\r\nset "PATH=%~dp0;%PATH%"\r\nfor %%I in ("%~dp0..") do set "PI_CODING_AGENT_DIR=%%~fI"\r\nnode "%~dp0..\\.pi-runtime\\node_modules\\@earendil-works\\pi-coding-agent\\${cliWindows}" %*\r\n`,
  );
}
function printRtkGuidance() {
  console.log("Optional RTK setup (manual only):");
  console.log(
    "Install RTK manually from https://github.com/rtk-ai/rtk#installation",
  );
  console.log("After installation, run: rtk init -g --agent pi");
}
const installConfirmation =
  "Continue? Type exactly 'yes' to archive and install, or anything else to cancel:";
function scopeText(paths, settings, host) {
  return [
    `Selected host: ${host}${host === detectedHost() ? "" : " (dry-run simulation only)"}`,
    "WARNING: this replaces the managed Pi profile and managed external configs; it does not merge configuration.",
    `Target profile: ${display(paths.target)}`,
    `Sibling managed config: ${display(paths.sibling)}`,
    `Global pi-lens config: ${display(paths.lensConfig)}`,
    `Old profile/config archive (outside target): ${display(paths.backup)}`,
    `Clean allowlist: ${PROFILE_FILES.join(", ")}`,
    `Latest package installs: ${settings.packages.map(packageSource).join(", ")}`,
    "RTK: not bundled or installed; install and configure it manually after setup if needed.",
    "Not copied: auth/login state, history/sessions, caches, MCP metadata, old roles, custom agents, friday prompt.",
    "Authentication/login must be repeated after installation.",
  ].join("\n");
}
async function chooseRtkGuidance() {
  const { answer, eof } = await askAnswer(
    "Would you like manual RTK guidance after installation? [yes/no, Enter means no]:\n> ",
  );
  if (eof) return null;
  const normalized = answer.toLowerCase();
  if (!normalized || normalized === "no") return false;
  if (normalized === "yes") return true;
  fail("invalid RTK guidance choice; answer yes or no");
}
async function confirm(text) {
  return (await ask(`${text}\n> `)).toLowerCase() === "yes";
}
async function writeSiblingAtomic(paths, content) {
  const temporary = path.join(
    paths.parent,
    `.pi-portable-web-search-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await fsp.writeFile(temporary, content, { flag: "wx" });
    if (
      process.env.PI_INSTALLER_TEST_MODE === "1" &&
      process.env.PI_INSTALLER_TEST_FAIL_SIBLING === "1"
    )
      fail("injected sibling write failure");
    await fsp.rename(temporary, paths.sibling);
  } catch (error) {
    error.siblingTemporary = temporary;
    try {
      await fsp.rm(temporary, { force: true });
    } catch (cleanupError) {
      error.siblingTemporaryCleanup = cleanupError;
    }
    throw error;
  }
}
async function moveFilePortable(source, destination) {
  await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  try {
    await fsp.rm(source);
  } catch (error) {
    try {
      await fsp.rm(destination, { force: true });
    } catch (cleanupError) {
      error.portableMoveCleanup = cleanupError;
    }
    throw error;
  }
}
async function writeLensConfigAtomic(paths, content) {
  await fsp.mkdir(paths.lensDir, { recursive: true });
  const temporary = path.join(
    paths.lensDir,
    `.pi-lens-config-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await fsp.writeFile(temporary, content, { flag: "wx" });
    await fsp.rename(temporary, paths.lensConfig);
  } catch (error) {
    error.lensTemporary = temporary;
    try {
      await fsp.rm(temporary, { force: true });
    } catch (cleanupError) {
      error.lensTemporaryCleanup = cleanupError;
    }
    throw error;
  }
}
async function moveProfileToArchive(paths, activation) {
  await fsp.mkdir(path.join(paths.backup, "profile"), { recursive: true });
  for (const entry of await fsp.readdir(paths.target, {
    withFileTypes: true,
  })) {
    if (isSkillsName(entry.name)) continue;
    await fsp.rename(
      path.join(paths.target, entry.name),
      path.join(paths.backup, "profile", entry.name),
    );
    activation.moved.push(entry.name);
  }
}
async function activateProfile(paths, stage, activation) {
  if (!fs.existsSync(paths.target)) {
    for (const entry of await fsp.readdir(stage, { withFileTypes: true }))
      if (isSkillsName(entry.name))
        await fsp.rm(path.join(stage, entry.name), {
          recursive: true,
          force: true,
        });
    await fsp.rename(stage, paths.target);
    activation.created = true;
    return;
  }
  await moveProfileToArchive(paths, activation);
  for (const entry of await fsp.readdir(stage, { withFileTypes: true })) {
    if (isSkillsName(entry.name)) {
      await fsp.rm(path.join(stage, entry.name), {
        recursive: true,
        force: true,
      });
      continue;
    }
    await fsp.rename(
      path.join(stage, entry.name),
      path.join(paths.target, entry.name),
    );
    activation.added.push(entry.name);
  }
}
async function rollback(
  paths,
  activation,
  movedSibling,
  newSibling,
  siblingTemporary,
  movedLensConfig,
  newLensConfig,
  lensTemporary,
  lensDirCreated,
) {
  const errors = [];
  const attempt = async (label, action) => {
    try {
      if (
        process.env.PI_INSTALLER_TEST_MODE === "1" &&
        process.env.PI_INSTALLER_TEST_ROLLBACK_FAIL === label
      )
        fail(`injected rollback failure: ${label}`);
      await action();
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  };
  if (siblingTemporary)
    await attempt("temporary sibling cleanup", () =>
      fsp.rm(siblingTemporary, { force: true }),
    );
  if (activation.created)
    await attempt("remove new profile", () =>
      fsp.rm(paths.target, { recursive: true, force: true }),
    );
  else {
    for (const name of [...activation.added].reverse())
      await attempt(`remove new profile entry ${name}`, () =>
        fsp.rm(path.join(paths.target, name), { recursive: true, force: true }),
      );
    await attempt("restore original profile", async () => {
      for (const name of [...activation.moved].reverse())
        await fsp.rename(
          path.join(paths.backup, "profile", name),
          path.join(paths.target, name),
        );
    });
  }
  if (newSibling)
    await attempt("remove new sibling config", () =>
      fsp.rm(paths.sibling, { force: true }),
    );
  if (movedSibling)
    await attempt("restore original sibling config", () =>
      fsp.rename(path.join(paths.backup, "web-search.json"), paths.sibling),
    );
  if (lensTemporary)
    await attempt("temporary pi-lens config cleanup", () =>
      fsp.rm(lensTemporary, { force: true }),
    );
  if (newLensConfig)
    await attempt("remove new pi-lens config", () =>
      fsp.rm(paths.lensConfig, { force: true }),
    );
  if (movedLensConfig)
    await attempt("restore original pi-lens config", async () => {
      await fsp.mkdir(paths.lensDir, { recursive: true });
      await moveFilePortable(
        path.join(paths.backup, "pi-lens", "config.json"),
        paths.lensConfig,
      );
    });
  if (lensDirCreated)
    await attempt("remove created pi-lens directory", async () => {
      try {
        await fsp.rmdir(paths.lensDir);
      } catch (error) {
        if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
      }
    });
  return errors;
}
export async function install(opts) {
  nodeCheck();
  const files = filesUnder(payloadRoot);
  const host = await chooseHost(opts);
  const paths = validatePaths(opts);
  const { settings, packages } = settingsFor(opts, files, paths, host);
  if (opts.dryRun) {
    console.log(scopeText(paths, settings, host));
    console.log(installConfirmation);
    console.log("DRY RUN: no prompt, installs, archive, or writes performed.");
    return;
  }
  console.log(scopeText(paths, { packages }, host));
  const rtkGuidance = await chooseRtkGuidance();
  if (rtkGuidance === null || !(await confirm(installConfirmation))) {
    console.log(
      "Cancelled; no target, managed configs, archive, downloads, or installs were changed.",
    );
    return;
  }
  checkNpm();
  await fsp.mkdir(path.dirname(paths.target), { recursive: true });
  const stage = await fsp.mkdtemp(
    path.join(path.dirname(paths.target), ".pi-portable-stage-"),
  );
  const activation = { created: false, moved: [], added: [] };
  let movedSibling = false,
    newSibling = false,
    siblingTemporary,
    movedLensConfig = false,
    newLensConfig = false,
    lensTemporary,
    lensDirCreated = false;
  try {
    await writePayload(stage, files, settings, host);
    await installStage(stage, settings);
    await fsp.mkdir(paths.backup, { recursive: true });
    await activateProfile(paths, stage, activation);
    if (fs.existsSync(stage))
      await fsp.rm(stage, { recursive: true, force: true });
    lensDirCreated = !fs.existsSync(paths.lensDir);
    if (fs.existsSync(paths.lensConfig)) {
      await fsp.mkdir(path.join(paths.backup, "pi-lens"), { recursive: true });
      await moveFilePortable(
        paths.lensConfig,
        path.join(paths.backup, "pi-lens", "config.json"),
      );
      movedLensConfig = true;
    }
    try {
      await writeLensConfigAtomic(
        paths,
        payloadText(files, "config/pi-lens.json"),
      );
      newLensConfig = true;
    } catch (error) {
      lensTemporary = error.lensTemporary;
      throw error;
    }
    if (fs.existsSync(paths.sibling)) {
      await fsp.rename(
        paths.sibling,
        path.join(paths.backup, "web-search.json"),
      );
      movedSibling = true;
    }
    try {
      await writeSiblingAtomic(
        paths,
        payloadText(files, "config/web-search.json"),
      );
      newSibling = true;
    } catch (error) {
      siblingTemporary = error.siblingTemporary;
      throw error;
    }
    await fsp.writeFile(
      path.join(paths.backup, "INSTALL-MANIFEST.json"),
      `${JSON.stringify({ target: display(paths.target), sibling: display(paths.sibling), lensConfig: display(paths.lensConfig), packages, archivedAt: new Date().toISOString(), retired: ["agent/agents", "subagents.json", "subagent-extensions/luna-fast.ts", "prompts/friday.md"] }, null, 2)}\n`,
    );
    console.log(`Installed clean profile at ${display(paths.target)}.`);
    console.log(`Installed pi-lens config at ${display(paths.lensConfig)}.`);
    console.log(`Archive preserved at ${display(paths.backup)}.`);
    console.log(
      `Add ${display(path.join(paths.target, "bin"))} to PATH to use the profile-local pi.`,
    );
    if (rtkGuidance) printRtkGuidance();
  } catch (error) {
    const rollbackErrors = await rollback(
      paths,
      activation,
      movedSibling,
      newSibling,
      siblingTemporary,
      movedLensConfig,
      newLensConfig,
      lensTemporary,
      lensDirCreated,
    );
    if (error.siblingTemporaryCleanup)
      rollbackErrors.push(
        `temporary sibling cleanup: ${error.siblingTemporaryCleanup.message}`,
      );
    if (error.lensTemporaryCleanup)
      rollbackErrors.push(
        `temporary pi-lens config cleanup: ${error.lensTemporaryCleanup.message}`,
      );
    if (error.portableMoveCleanup)
      rollbackErrors.push(
        `portable file move cleanup: ${error.portableMoveCleanup.message}`,
      );
    try {
      if (fs.existsSync(stage))
        await fsp.rm(stage, { recursive: true, force: true });
    } catch (cleanupError) {
      rollbackErrors.push(`remove staging directory: ${cleanupError.message}`);
    }
    const recovery = rollbackErrors.length
      ? `ROLLBACK INCOMPLETE; Archive: ${display(paths.backup)}; recover manually: ${rollbackErrors.join("; ")}`
      : `Original profile/config restored where present; archive retained at ${display(paths.backup)}`;
    fail(`INSTALL FAILED; ${recovery}. ${error.message}`);
  }
}
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  await install(opts);
}
if (process.env.PI_INSTALLER_TEST_LIBRARY !== "1")
  main()
    .catch((error) => {
      console.error(`ERROR: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(closeInput);
