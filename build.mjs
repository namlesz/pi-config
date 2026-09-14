#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "installer");
const payloadRoot = path.join(installer, "payload");
const output = path.join(installer, "pi-portable-installer.sh");
const enginePath = path.join(installer, "engine.mjs");
const forbiddenName =
  /(^|[/\\])(auth\.json|trust\.json|models-store\.json|subagents\.json|run-history|sessions|mcp-cache|mcp-onboarding|node_modules|friday\.md|rtk(?:[-.]|$)|herdr(?:[-.]|$)|orca(?:[-.]|$)|quotas?\.json|zentui(?:\.json|$)|pi-permission-system)([/\\]|$)/i;
const forbiddenContent =
  /awis02|BEGIN (?:RSA|OPENSSH|EC|PRIVATE)|sk-[A-Za-z0-9]{16,}/;
const excludedDirectoryNames = new Set([
  ".ruff_cache",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
]);

function filesUnder(dir) {
  if (!fs.lstatSync(dir).isDirectory())
    throw new Error(`payload root is not a regular directory: ${dir}`);
  const result = [];
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectoryNames.has(entry.name))
        result.push(...filesUnder(full));
    } else if (entry.isFile()) result.push(full);
    else
      throw new Error(`payload contains unsupported filesystem entry: ${full}`);
  }
  return result;
}
const payload = filesUnder(payloadRoot);
fs.readFileSync(enginePath, "utf8");
for (const file of payload) {
  const relative = path.relative(payloadRoot, file).replaceAll(path.sep, "/");
  if (forbiddenName.test(relative))
    throw new Error(`forbidden payload path: ${relative}`);
  if (forbiddenContent.test(fs.readFileSync(file, "utf8")))
    throw new Error(
      `possible secret or machine username in payload: ${relative}`,
    );
}
for (const host of ["windows", "unix"]) {
  const template = path.join(installer, `host-${host}.txt`);
  if (!fs.lstatSync(template).isFile())
    throw new Error(`host template is not a regular file: ${template}`);
  const text = fs.readFileSync(template, "utf8");
  if (forbiddenContent.test(text))
    throw new Error(
      `possible secret or machine username in host template: ${host}`,
    );
}
const shell = `#!/usr/bin/env bash
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "\${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/engine.mjs" "$@"
`;
fs.writeFileSync(output, shell, { mode: 0o755 });
console.log(
  `built ${path.relative(root, output)} (${Buffer.byteLength(shell)} bytes, ${payload.length} local payload files)`,
);
