# pi-copy

**pi-copy — open `$EDITOR` from [pi](https://github.com/earendil-works/pi-mono) and copy the result to your clipboard.**

## What it does

Press **`Ctrl-K Ctrl-K`** in pi's prompt editor and your `$VISUAL` / `$EDITOR`
opens on an empty scratch buffer. Write whatever you want, save, and quit with
exit code `0` (e.g. `:wq` / `:x` in vim) — the buffer's contents are copied to
your system clipboard. A non-zero exit (e.g. `:cq`, or an unsaved quit) leaves
the clipboard untouched and shows a notification.

Prefer a command? **`/picopy`** opens the editor the same way without needing
the chord.

## Install

**Prerequisites:** Node.js 20+ and pi 0.79.x.

pi loads extensions via [jiti](https://github.com/unjs/jiti) at startup, so
**no build step is needed** — pi-copy ships TypeScript source and pi transpiles
on the fly.

Pick one of the two install paths:

### Option A — copy or symlink into `~/.pi/agent/extensions/`

pi-copy is split into a small set of `.ts` modules. Copy (or symlink) the whole
`src/` tree as a directory with an `index.ts` entry:

```sh
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/src" ~/.pi/agent/extensions/pi-copy
```

The resulting layout pi will discover:

```
~/.pi/agent/extensions/
  pi-copy/
    index.ts        # entry (default export)
    chord.ts
    clipboard.ts
    editor.ts
    handler.ts
    options.ts
```

pi's loader resolves a subdirectory containing `index.ts` automatically
(`pi-copy/index.ts`); a single-file `pi-copy.ts` would also work, but the
directory form is what the multi-module source needs.

### Option B — reference the repo path from `settings.json`

Add the source directory to the `extensions` array in
`~/.pi/agent/settings.json` (or the project-local `.pi/settings.json`):

```json
{
  "extensions": [
    "/absolute/path/to/pi-copy/src"
  ]
}
```

This is the most convenient layout while developing — edit a file, restart pi,
done.

> Both options resolve the same way internally: pi's
> `discoverAndLoadExtensions` walks `<cwd>/.pi/extensions/`,
> `~/.pi/agent/extensions/`, and the `extensions` array from `settings.json`,
> in that order, then loads each entry through jiti.

Verify it loaded:

```sh
pi -e ./src/index.ts --mode json -p ""
# Should print a {"type":"session",...} line and exit 0 with no errors.
```

## The `Ctrl-K` conflict (and how to remap)

There is no native key-chord support in pi — a `KeyId` is a single key combo
like `"ctrl+k"`, not a sequence. pi-copy implements `Ctrl-K Ctrl-K` by
registering `ctrl+k` and detecting the double-tap inside the handler. **This
shadows pi's default `ctrl+k` binding, `tui.editor.deleteToLineEnd`
(delete-to-end-of-line) in the prompt editor.** The first tap only "arms" the
chord (no text is deleted), but the delete behavior is unavailable until you
remap it.

To get **both** behaviors, move delete-to-end-of-line to a different key in
`~/.pi/agent/keybindings.json`:

```json
{
  "tui.editor.deleteToLineEnd": "ctrl+shift+k"
}
```

After this, `Ctrl-K Ctrl-K` runs pi-copy and `Ctrl-Shift-K` deletes to end of
line.

Prefer a different trigger key entirely? Set the **`PICOPY_KEY`** environment
variable to move the pi-copy chord itself. For example, to use `Ctrl-L Ctrl-L`
instead:

```sh
export PICOPY_KEY="ctrl+l"
```

Note that `PICOPY_KEY` is an **environment variable**, not a keybinding — it
controls the key pi-copy registers, independently of `keybindings.json`.

## Editor selection

The editor command is resolved with this precedence (highest wins):

1. **`$PICOPY_EDITOR`** — explicit override.
2. **`$VISUAL`** — standard Unix convention.
3. **`$EDITOR`** — fallback.

The chosen string is split on whitespace into a command plus args, so
`code --wait` works as-is:

```sh
export VISUAL="code --wait"   # VS Code: block until the editor window closes
export EDITOR="vim"
```

**v1 limitation:** the split is a naive whitespace split — no shell quoting or
escaping. An editor path or arg that contains spaces (e.g.
`/Applications/Visual Studio Code.app/...`) will be split incorrectly. Wrap
such commands in a small shell script and point `$PICOPY_EDITOR` at the script.

## Clipboard prerequisites by platform

pi-copy writes via the platform's native clipboard tool:

| Platform             | Tool                   | Install if missing                                  | Notes                                                                |
| -------------------- | ---------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| macOS                | `pbcopy`               | Built in                                            |                                                                      |
| Windows              | `clip.exe`             | Built in                                            | Appends a trailing newline; UTF-8 quirks (v1 known limitation).      |
| Linux (Wayland)      | `wl-copy`              | `pacman -S wl-clipboard` / `apt install wl-clipboard` | Active when `WAYLAND_DISPLAY` is set and non-empty.                  |
| Linux (X11)          | `xclip` (preferred) or `xsel` | `apt install xclip` / `apt install xsel`            | `xclip -selection clipboard`, falling back to `xsel --clipboard --input`. |
| Termux / Android     | `termux-clipboard-set` | `pkg install termux-api` + the Termux:API app       |                                                                      |

On Linux without `WAYLAND_DISPLAY`, pi-copy prefers `xclip` and falls back to
`xsel`. If neither is on `PATH`, the copy fails with an actionable
"clipboard tool not found" notification telling you exactly what to install.

Other platforms (FreeBSD, OpenBSD, AIX, etc.) are unsupported in v1.

## Configuration

All configuration is via environment variables. Unset variables use the
documented defaults.

| Variable                  | Default      | Valid values                                              | Effect                                                                                                                                                                  |
| ------------------------- | ------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PICOPY_KEY`              | `ctrl+k`     | Any pi `KeyId` string (e.g. `ctrl+l`)                     | The key registered as the chord trigger. The double-tap is detected inside this single key.                                                                            |
| `PICOPY_WINDOW_MS`        | `400`        | Positive integer (ms)                                     | Max time between the first and second tap. A second tap within the window fires; a later tap re-arms.                                                                   |
| `PICOPY_REQUIRE_EXIT_ZERO`| `true`       | `true`/`1`/`yes`/`on` (truthy) or `false`/`0`/`no`/`off` (falsy), case-insensitive | If `true`, copy **only** when `$EDITOR` exits `0`. If `false`, copy on any non-null exit code (a signal/crash exit still never copies).                                 |
| `PICOPY_EDITOR`           | unset        | Any command string (may include args, whitespace-split)  | Overrides `$VISUAL` / `$EDITOR`.                                                                                                                                        |
| `PICOPY_PREFILL`          | `none`       | `none` or `lastAssistant`                                 | `lastAssistant` is **reserved for a future release** — accepted but ignored in v1 (no buffer pre-fill). Any other value is invalid and falls back to `none`.           |

Invalid values fall back to the default and log a single `[pi-copy] ...`
warning to stderr at load time, so typos like `PICOPY_WINDOW_MS=garbage` are
visible instead of silently broken.

## How it works

1. **Chord detection.** The first `Ctrl-K` "arms" the chord and shows a status
   hint ("press Ctrl-K again to copy…"). The second tap within
   `PICOPY_WINDOW_MS` fires; a later tap starts a fresh arm cycle. A stale
   armed state never fires on its own. The hint auto-clears after the window.
2. **TTY handoff.** pi-copy writes an empty tmp file, calls `tui.stop()` to
   release the terminal, spawns `$EDITOR` with `stdio: "inherit"` (so the
   editor owns the TTY), then on exit calls `tui.start()` +
   `tui.requestRender(true)` to resume pi and force a full redraw. This mirrors
   pi's own built-in external-editor flow.
3. **Exit-code gate.** On exit `0` the buffer is read back and copied. On a
   non-zero exit the clipboard is left untouched (configurable via
   `PICOPY_REQUIRE_EXIT_ZERO=0`). A signal/crash exit (`null`) never copies.
4. **Cross-platform clipboard write.** pi-copy picks the right tool per
   platform, spawns it, writes the text to its stdin with no extra trailing
   newline, and awaits exit. Failure modes (missing binary, non-zero exit)
   surface as actionable notifications.

The architecture intentionally splits **pure, unit-testable** decision logic
(`chord.ts`, `options.ts`, `editor.ts`, `clipboard.ts` selection) from the
**impure** I/O seams (`handler.ts` orchestration, `index.ts` factory). All
time, `spawn`, `fs`, and `which` dependencies are injectable for tests.

## Troubleshooting

**Nothing happens when I press `Ctrl-K Ctrl-K`.**
You must be in **interactive (TUI) mode** — pi-copy no-ops in `rpc`, `json`, or
`print` modes. The first tap only *arms* the chord; press `Ctrl-K` a second
time within `PICOPY_WINDOW_MS` (default 400 ms) to fire. If you remapped the
key with `PICOPY_KEY`, use that key instead.

**The clipboard is unchanged after I exit the editor.**
The editor exited non-zero. Save before quitting — use `:wq` or `:x` in vim,
not `:cq` (which exits with code 1). If your editor's "save and quit" still
returns non-zero, you can relax the gate with `PICOPY_REQUIRE_EXIT_ZERO=0`
(note: a signal/crash exit is never copied regardless).

**The copied text has a trailing newline on Windows.**
This is a known limitation of `clip.exe`. No fix is planned for v1.

**"pi-copy: clipboard tool not found. ..."**
The platform's clipboard binary is missing. Install it per the
[clipboard prerequisites table](#clipboard-prerequisites-by-platform) above.

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest run
```

Load the in-tree source directly while iterating:

```sh
pi -e ./src/index.ts
```

Source layout:

```
src/
  index.ts        # impure factory: read options, validate env, registerShortcut + /picopy
  options.ts      # PURE: readOptions + validateOptions
  chord.ts        # PURE: double-tap chord state machine
  editor.ts       # PURE: resolveEditorCmd (PICOPY_EDITOR > VISUAL > EDITOR)
  clipboard.ts    # PURE picker + IMPURE writer (deps injected)
  handler.ts      # IMPURE orchestrator: TTY handoff, exit gate, copy, notify
test/
  ...corresponding unit tests; handler tests inject fake tui/spawn/fs
```

See `OBJECTIVE.md` for the v1 goal and explicit out-of-scope items, and the
(local, gitignored) `PLAN.md` for the checkpoint-by-checkpoint build history.

## Status

Experimental / personal use.
