# Portable Pi installer

`installer/pi-portable-installer.sh` is a small Bash launcher for the adjacent `engine.mjs`. The engine reads `installer/payload/` and the adjacent host templates at runtime, so invocation works from any current directory. It requires **Bash** (Linux/macOS Bash or Windows Git Bash), Node.js >=22.19, and npm.

```bash
bash installer/pi-portable-installer.sh --help
bash installer/pi-portable-installer.sh --dry-run
bash installer/pi-portable-installer.sh --host windows
```

The installer prompts for `windows` or `unix` when `--host` is omitted, then prints the exact clean replacement scope and requires typing `yes`. It archives the existing profile (except the existing `skills` directory, which remains in place and untouched), sibling `web-search.json`, and global `~/.pi-lens/config.json` outside the target, installs a fresh allowlist, and restores originals on failure. Never run it against the live development profile while developing the installer.

The default target is `$PI_CODING_AGENT_DIR` or `~/.pi/agent`; use `--target PATH` for a sandbox. `--settings-template PATH` accepts the approved complete template. The default installs the latest npm package versions and generates host-specific `APPEND_SYSTEM.md`; versions may differ between runs. RTK is not bundled, downloaded, installed, or copied. If needed, install it manually from <https://github.com/rtk-ai/rtk#installation>, then run `rtk init -g --agent pi` after setup.

The installer also writes the bundled Pi Lens user configuration to `~/.pi-lens/config.json` (or `%USERPROFILE%\\.pi-lens\\config.json` on Windows). The current profile keeps lazy tools enabled with `tools.lazy: true`, disables automatic context injection and startup project scans, enables shared-checkout protection and actionable warning reports with LSP code actions, and leaves automatic LSP quick-fix application disabled.

Credentials, sessions/history, caches, secrets, old roles, and retired resources are never shipped or copied into the new profile. Authentication must be repeated. Existing target skills are neither installed nor removed. Orca/Herdr desktop applications are not installed.

Build and test:

```bash
node installer/build.mjs
node installer/test.mjs
node migration-work/runtime-smoke/background-resume.mjs
```

The installer sandbox suite and the Windows background/resume runtime smoke passed. Linux/macOS execution remains untested.
