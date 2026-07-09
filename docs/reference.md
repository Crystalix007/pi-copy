# pi-copy reference

Detailed configuration and troubleshooting for [pi-copy](../README.md). The
[README](../README.md) has the short version.

## Environment variables

All configuration is via environment variables. Unset values use the defaults shown.
Invalid values fall back to the default and log a `[pi-copy] …` warning to stderr at load
time — **one warning per invalid value**.

| Variable | Default | Valid values | Effect |
| --- | --- | --- | --- |
| `PICOPY_KEY` | `ctrl+k` | Any non-empty string | The key registered as the trigger. The double-tap is detected on this single key. (Free-form — no warning for odd values.) |
| `PICOPY_WINDOW_MS` | `400` | Positive integer (ms) | Max time between the first and second tap. A second tap within the window fires; a later tap re-arms. |
| `PICOPY_REQUIRE_EXIT_ZERO` | `true` | Truthy: `true`/`1`/`yes`/`on`; falsy: `false`/`0`/`no`/`off` (case-insensitive) | If `true`, copy **only** when the editor exits `0`. If `false`, copy on any non-null exit (a signal/crash exit still never copies). |
| `PICOPY_EDITOR` | _unset_ | Any non-empty command string (whitespace-split) | Overrides `$VISUAL` / `$EDITOR`. Empty is treated as unset. |
| `PICOPY_PREFILL` | `none` | `none` or `lastAssistant` | `lastAssistant` is **reserved for a future release** — accepted but ignored in v1. Any other value is invalid and falls back to `none`. |

For example, to use `Ctrl-L Ctrl-L`, a faster double-tap window, and relax the exit gate:

```sh
export PICOPY_KEY="ctrl+l"
export PICOPY_WINDOW_MS="300"
export PICOPY_REQUIRE_EXIT_ZERO="0"
```

## Editor selection

The editor command is resolved with this precedence (highest wins):

1. **`$PICOPY_EDITOR`** — explicit override.
2. **`$VISUAL`** — standard Unix convention.
3. **`$EDITOR`** — fallback.

A value that is empty or whitespace-only at any level is treated as unset and falls
through to the next. The chosen string is split on whitespace into a command plus args, so
`code --wait` works as-is:

```sh
export VISUAL="code --wait"   # VS Code: block until the editor window closes
export EDITOR="vim"
```

> **v1 limitation:** the split is a naive whitespace split — no shell quoting or escaping.
> An editor path or arg that contains spaces (e.g.
> `/Applications/Visual Studio Code.app/...`) will be split incorrectly. Wrap such
> commands in a small shell script and point `$PICOPY_EDITOR` at the script.

## Clipboard prerequisites

pi-copy writes via the platform's native clipboard tool:

| Platform | Tool | Install if missing | Notes |
| --- | --- | --- | --- |
| macOS | `pbcopy` | Built in | |
| Windows | `clip.exe` | Built in | Appends a trailing newline (known v1 limitation). |
| Linux (Wayland) | `wl-copy` | `pacman -S wl-clipboard` / `apt install wl-clipboard` | Used when `WAYLAND_DISPLAY` is set and non-empty. |
| Linux (X11) | `xclip` (preferred) or `xsel` | `apt install xclip` / `apt install xsel` | `xclip -selection clipboard`, falling back to `xsel --clipboard --input`. |
| Termux / Android | `termux-clipboard-set` | `pkg install termux-api` + the Termux:API app | |

Selection logic: on Linux without `WAYLAND_DISPLAY`, pi-copy prefers `xclip` and falls
back to `xsel`; if neither is on `PATH`, the copy fails with an actionable "clipboard tool
not found" notification. On macOS / Windows / Wayland / Termux the tool is assumed present,
so a missing binary surfaces as a spawn error at copy time rather than being pre-detected.
Other platforms (FreeBSD, OpenBSD, AIX, etc.) are unsupported in v1.

## The `Ctrl-K` key conflict

There is no native key-chord support in pi — a `KeyId` is a single key combo like
`"ctrl+k"`, not a sequence. pi-copy implements `Ctrl-K Ctrl-K` by registering `ctrl+k` and
detecting the double-tap inside the handler.

**This shadows pi's default `ctrl+k` binding**, `tui.editor.deleteToLineEnd`
(delete-to-end-of-line) in the prompt editor. The first tap only "arms" the chord (no text
is deleted), so the delete behavior is unavailable until you remap it.

### Keep both behaviors

Move delete-to-end-of-line to a different key in `~/.pi/agent/keybindings.json`:

```json
{
  "tui.editor.deleteToLineEnd": "ctrl+shift+k"
}
```

Now `Ctrl-K Ctrl-K` runs pi-copy and `Ctrl-Shift-K` deletes to end of line.

### Move the pi-copy chord instead

Set the **`PICOPY_KEY`** environment variable to use a different trigger — e.g.
`Ctrl-L Ctrl-L`:

```sh
export PICOPY_KEY="ctrl+l"
```

Note that `PICOPY_KEY` is an **environment variable**, not a keybinding — it controls the
key pi-copy registers, independently of `keybindings.json`.

## Behavior notes

- **One trailing newline is stripped** from the copied text. If your buffer ends with a
  single `\n` it is removed; further trailing newlines are kept.
- **Warnings are per invalid value.** Each invalid environment variable logs its own
  `[pi-copy] …` line at load time, so typos like `PICOPY_WINDOW_MS=garbage` are visible
  rather than silently broken.
- **Windows trailing newline.** `clip.exe` always appends a trailing newline; no fix is
  planned for v1.
- **Windows editor launch** uses `shell: true`, so editor commands are interpreted by the
  shell. On other platforms the command is split directly (see the editor limitation above).

## Troubleshooting

**Nothing happens when I press `Ctrl-K Ctrl-K`.**
You must be in **interactive (TUI) mode** — pi-copy shows a warning and does nothing in
`rpc`, `json`, or `print` modes. The first tap only _arms_ the chord; press `Ctrl-K` a
second time within `PICOPY_WINDOW_MS` (default 400 ms) to fire. If you remapped the key
with `PICOPY_KEY`, use that key instead.

**The clipboard is unchanged after I exit the editor.**
The editor exited non-zero. Save before quitting — use `:wq` or `:x` in vim, not `:cq`
(which exits with code 1). If your editor's "save and quit" still returns non-zero, you
can relax the gate with `PICOPY_REQUIRE_EXIT_ZERO=0` (a signal/crash exit is never copied
regardless).

**The copied text has a trailing newline on Windows.**
Known limitation of `clip.exe`. No fix is planned for v1.

**"pi-copy: clipboard tool not found. …"**
The platform's clipboard binary is missing. Install it per the
[clipboard prerequisites](#clipboard-prerequisites) above.

**`pi install` didn't load the extension.**
Confirm it's listed (`pi list`) and that `package.json` declares the extension under the
`pi` manifest. Don't combine `pi install` with a manual symlink or `extensions`-array
entry for the same extension — pick one method (see
[Manual & dev install](internals.md#manual--dev-install)).
