# Local Pi workarounds

## `pi-subagents` foreground child cannot import Pi

### Symptom

A foreground launch (`async: false`) fails before the child starts:

```text
Cannot find package '@earendil-works/pi-coding-agent' imported from
~/.pi/agent/npm/node_modules/pi-subagents/src/runs/shared/child-session.js
```

After exposing the package with only a directory symlink, Jiti may instead report:

```text
Cannot find package '~/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/index.js'
```

Background children work because `pi-subagents` supplies a `JITI_ALIAS` map for its detached runner. The foreground path in `pi-subagents 0.70.0` performs a direct dynamic import from the package installed under `~/.pi/agent/npm/`. Node does not search globally installed npm packages from there, and the foreground Jiti resolver expects `index.js` despite Pi exporting `dist/index.js`.

### Local fix applied

Two symbolic links bridge the resolver paths while keeping one physical Pi installation:

```text
~/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent
  -> $(npm root -g)/@earendil-works/pi-coding-agent

$(npm root -g)/@earendil-works/pi-coding-agent/index.js
  -> dist/index.js
```

This was verified with a successful foreground `scout` launch using `async: false`.

### Restore after updates

`pi update` or `pi update --extensions` may remove either link. Restore them with:

```bash
set -euo pipefail

PI_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent"
PLUGIN_PEER="$HOME/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent"

[ -f "$PI_ROOT/dist/index.js" ] || { echo "Pi dist/index.js not found: $PI_ROOT" >&2; exit 1; }
mkdir -p "$(dirname "$PLUGIN_PEER")"

if [ -L "$PLUGIN_PEER" ]; then
  rm "$PLUGIN_PEER"
elif [ -e "$PLUGIN_PEER" ]; then
  echo "Refusing to replace non-symlink: $PLUGIN_PEER" >&2
  exit 1
fi
ln -s "$PI_ROOT" "$PLUGIN_PEER"

if [ -L "$PI_ROOT/index.js" ]; then
  rm "$PI_ROOT/index.js"
elif [ -e "$PI_ROOT/index.js" ]; then
  echo "Refusing to replace non-symlink: $PI_ROOT/index.js" >&2
  exit 1
fi
ln -s dist/index.js "$PI_ROOT/index.js"

(
  cd "$HOME/.pi/agent/npm/node_modules/pi-subagents"
  node -e "import('@earendil-works/pi-coding-agent').then(m => { if (!m.createAgentSession) throw new Error('Pi SDK export missing'); console.log('Pi peer import: OK') })"
)
```

Then restart Pi and smoke-test a foreground subagent (`async: false`).

### Removal

Remove only the two symbolic links:

```bash
rm "$HOME/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent"
rm "$(npm root -g)/@earendil-works/pi-coding-agent/index.js"
```

Do not remove `~/.pi/agent/`; it contains settings, credentials, extensions, and sessions.

### Long-term resolution

Remove this workaround once `pi-subagents` resolves the host Pi package for foreground children the same way it does for background children.
