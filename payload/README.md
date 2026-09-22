# Portable Pi profile installer payload

These are the local, sanitized resources consumed by `../engine.mjs`; they are not embedded in the shell launcher. The engine reads them relative to the installer directory, independent of the caller's current directory.

The clean replacement contains the sanitized settings template, shared `APPEND_SYSTEM.md` plus the selected host environment section, `mcp.json`, `web-search.json`, the managed global Pi Lens `config.json`, allowlisted extensions, profile-local launchers, Pi's isolated npm runtime, and installed packages. Existing target `skills` resources are deliberately left in place and are neither copied nor installed.

Credentials, secrets, sessions/history, caches, model/trust/runtime MCP metadata, usernames, custom agents, quota or permission configuration, Zentui snapshots, and retired RTK, Herdr, Orca, and `friday` resources are not shipped. Authentication and provider login must be repeated.
