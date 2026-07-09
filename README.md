# pi-copy

Open `$EDITOR` from [pi](https://github.com/earendil-works/pi-mono), write whatever you
want, and on a clean save the result lands on your clipboard — without leaving pi.

> Press **`Ctrl-K Ctrl-K`** in pi's prompt (or run **`/picopy`**), type in your editor,
> then save & quit with exit code `0` (e.g. `:wq` in vim). The buffer is copied to your
> system clipboard. Quit without saving (`:cq`) and the clipboard is left untouched.

## Requirements

- **[pi](https://github.com/earendil-works/pi-mono)** 0.79+ and **Node.js** 20+.
- A platform clipboard tool: `pbcopy` (macOS, built in), `clip.exe` (Windows, built in),
  or `xclip` / `xsel` / `wl-copy` on Linux. If one is missing, pi-copy tells you exactly
  what to install. (Full list in [docs/reference.md](docs/reference.md#clipboard-prerequisites).)

## Install

```sh
pi install git:github.com/Crystalix007/pi-copy
```

That clones the repo, runs `npm install`, and registers the package with pi. Restart pi
(or run `/reload` in a running session) and pi-copy is live.

Verify it loaded:

```sh
pi list          # should show: git:github.com/Crystalix007/pi-copy
```

<details>
<summary>Other install forms, updating, uninstalling</summary>

```sh
pi install https://github.com/Crystalix007/pi-copy       # HTTPS URL instead of the git: shorthand
pi install git:github.com/Crystalix007/pi-copy@main      # pin a branch or tag
pi update --extension git:github.com/Crystalix007/pi-copy
pi remove  git:github.com/Crystalix007/pi-copy
```

There is **no bare `owner/repo` short form** — use the `git:github.com/...` shorthand or a
full `https://` URL.

Installing from a local clone or hacking on pi-copy? See
[Manual & dev install](docs/internals.md#manual--dev-install).

</details>

## Usage

| Action | How |
| --- | --- |
| Copy via editor | Press **`Ctrl-K Ctrl-K`** in pi's prompt |
| Copy via editor (no chord) | Run the **`/picopy`** command |
| Cancel | Quit the editor non-zero (e.g. `:cq`) or just don't save |

The first `Ctrl-K` only *arms* the chord and shows a hint; press `Ctrl-K` again within
400 ms to open the editor.

> **The `Ctrl-K` key conflict.** pi-copy registers `Ctrl-K`, which shadows pi's default
> "delete to end of line" in the prompt. To keep both, remap that to another key (e.g.
> `Ctrl-Shift-K`) in `~/.pi/agent/keybindings.json`, or move the pi-copy chord itself with
> `PICOPY_KEY`. Details in [docs/reference.md](docs/reference.md#the-ctrl-k-key-conflict).

## Configuration

Everything is via environment variables; unset values use the defaults.

| Variable | Default | What it does |
| --- | --- | --- |
| `PICOPY_KEY` | `ctrl+k` | Key registered as the trigger (double-tap this key). |
| `PICOPY_WINDOW_MS` | `400` | Max milliseconds between the two taps. |
| `PICOPY_REQUIRE_EXIT_ZERO` | `true` | Copy only when the editor exits `0`. Set `0` to copy on any non-crash exit. |
| `PICOPY_EDITOR` | *unset* | Override `$VISUAL` / `$EDITOR` for the editor command. |
| `PICOPY_PREFILL` | `none` | Reserved for a future release (`lastAssistant` is accepted but ignored). |

Editor resolution: `PICOPY_EDITOR` > `$VISUAL` > `$EDITOR`. Example:
`export VISUAL="code --wait"`.

For the full reference — every valid value, the editor-command limitation, clipboard
prereqs per platform, and keybinding remapping — see [docs/reference.md](docs/reference.md).

## Troubleshooting

**Nothing happens on `Ctrl-K Ctrl-K`.** You must be in interactive (TUI) mode, and press
`Ctrl-K` **twice** within 400 ms — the first tap only arms it. (If you set `PICOPY_KEY`,
double-tap that key instead.)

**Clipboard unchanged after I quit the editor.** The editor exited non-zero. Save before
quitting (`:wq` / `:x`, not `:cq`). Or relax the rule: `PICOPY_REQUIRE_EXIT_ZERO=0`.

**"clipboard tool not found".** Your platform's clipboard binary is missing — install it
per the [clipboard prerequisites](docs/reference.md#clipboard-prerequisites).

More in [docs/reference.md](docs/reference.md#troubleshooting).

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest run
```

Architecture, source layout, and manual install live in [docs/internals.md](docs/internals.md).

## Status

Experimental / personal use. See [OBJECTIVE.md](OBJECTIVE.md) for the v1 scope.
