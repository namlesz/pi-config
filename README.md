# Portable Pi installer

`pi-portable-installer.sh` is a small, committed Bash launcher for the adjacent `engine.mjs`. The engine reads `payload/` and the adjacent host templates at runtime, so invocation works from any current directory. It requires **Bash** (Linux/macOS Bash or Windows Git Bash), Node.js >=22.19, and npm.

```bash
bash pi-portable-installer.sh --help
bash pi-portable-installer.sh --dry-run
bash pi-portable-installer.sh --host windows
```

The installer prompts for `windows` or `unix` when `--host` is omitted, then prints the exact clean replacement scope and requires typing `yes`. It archives the existing profile (except the existing `skills` directory, which remains in place and untouched), sibling `web-search.json`, and global `~/.pi-lens/config.json` outside the target, installs a fresh allowlist, and restores originals on failure. Never run it against the live development profile while developing the installer.

The default target is `$PI_CODING_AGENT_DIR` or `~/.pi/agent`; use `--target PATH` for a sandbox. `--settings-template PATH` accepts the approved complete template. The default installs the latest npm package versions and generates host-specific `APPEND_SYSTEM.md`; versions may differ between runs. RTK is not bundled, downloaded, installed, or copied. If needed, install it manually from <https://github.com/rtk-ai/rtk#installation>, then run `rtk init -g --agent pi` after setup.

The installer also writes the bundled Pi Lens user configuration to `~/.pi-lens/config.json` (or `%USERPROFILE%\\.pi-lens\\config.json` on Windows). The current profile keeps lazy tools enabled with `tools.lazy: true`, disables automatic context injection and startup project scans, enables shared-checkout protection and actionable warning reports with LSP code actions, and leaves automatic LSP quick-fix application disabled.

Credentials, sessions/history, caches, secrets, old roles, and retired resources are never shipped or copied into the new profile. Authentication must be repeated. Existing target skills are neither installed nor removed. Orca/Herdr desktop applications are not installed.

## Optional skills (manual installation)

The installer does not bundle or install these skills. The local reference setup keeps them in `~/.agents/skills/`; install selected skills yourself from a trusted source, preserving each complete skill directory, then expose them to Pi through its `skills` settings or agent-directory `skills/`. Do not assume another machine already has this shared directory.

| Skill | Purpose |
|---|---|
| `brainstorming` | Clarify requirements and approve a design before implementation. |
| `codebase-design` | Design deep modules and clear interfaces. |
| `create-agentsmd` | Write repository instructions for coding agents. |
| `create-specification` | Write structured requirements and solution specifications. |
| `find-skills` | Discover additional skills. |
| `frontend-design` | Design intentional, distinctive interfaces. |
| `grill-me` | Challenge and refine a plan through an interview. |
| `handoff` | Summarize a session for the next agent. |
| `improve-codebase-architecture` | Find and discuss architecture improvements. |
| `playwright-cli` | Automate browser interactions and checks. |
| `receiving-code-review` | Evaluate review feedback before applying it. |
| `skill-creator` | Create, improve, and evaluate skills. |
| `systematic-debugging` | Diagnose root causes before fixing bugs. |

These names are an inventory, not verified download sources or a compatibility guarantee. Check each skill's dependencies and Pi compatibility before installing it. In particular, `grill-me` calls a separate `grilling` skill not present in this inventory; some skills expect a `Skill` tool. Browser checks still require approval under the profile's policy.

### Ponytail (separate GitHub package)

Ponytail is deliberately excluded from the installer's package list and the manual skill inventory above. If wanted, install the complete package separately using the [upstream Pi instructions](https://github.com/DietrichGebert/ponytail#pi-agent-harness):

```bash
pi install git:github.com/DietrichGebert/ponytail
```

This command is for manual use after setup; the portable installer never runs it. Existing local Ponytail installations are not uninstalled by this repository change. A later clean profile replacement does not preserve a separately added package declaration, so reinstall Ponytail afterward if needed.

## Optional tools (manual installation)

No tools below are installed or copied by these recommendations. Install only those needed for your projects, using binaries appropriate to the host OS. Pi Lens may manage some tools separately; check availability first rather than installing duplicates.

| Tool | Useful for |
|---|---|
| `rg` (ripgrep) | Fast text search. |
| `fd` | Fast file discovery. |
| `shellcheck` | Shell-script diagnostics. |
| `shfmt` | Shell-script formatting. |
| `marksman` | Markdown language-server diagnostics and navigation. |
| `taplo` | TOML validation and language-server support. |
| `typos-lsp` | Typo diagnostics. |
| `actionlint` | GitHub Actions workflow checks. |
| `zizmor` | GitHub Actions security checks. |
| `gitleaks` | Secret detection. |
| `opengrep` | Pattern-based static analysis. |
| `csharp-ls` | C# language-server support, when working with .NET. |

## Payload safety checks

Before any prompt or write (including `--dry-run`), the engine rejects payload files whose names match retired or private resources (`auth.json`, `sessions`, `node_modules`, …) and content containing private keys, `sk-…` tokens, or a home-path segment with the current OS username. Add other names to block (for example, a username from another machine) as a comma-separated list in `PI_INSTALLER_FORBIDDEN_NAMES`.

## Profile launchers

The installed `bin/pi` and `bin/pi.cmd` both run `node` from `PATH`, so they keep working after a Node upgrade. That `node` must still satisfy the Pi runtime's minimum version.

## Test

```bash
node test.mjs
```

The sandbox suite mocks npm and Pi, uses a fake home directory, and never touches the live profile. The current suite was run on macOS; earlier versions passed on Windows. Linux is untested.
