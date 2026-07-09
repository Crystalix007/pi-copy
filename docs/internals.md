# pi-copy internals

How pi-copy works, its source layout, and how to develop or install it manually. For
configuration and troubleshooting see [reference.md](reference.md); for the short version
see the [README](../README.md).

## How it works

1. **Chord detection.** The first `Ctrl-K` "arms" the chord and shows a status hint
   ("press Ctrl-K again to copy…"). A second tap within `PICOPY_WINDOW_MS` fires; a later
   tap starts a fresh arm cycle. A stale armed state never fires on its own, and the hint
   auto-clears after the window.
2. **TTY handoff.** pi-copy writes an empty tmp file, calls `tui.stop()` to release the
   terminal, spawns the editor with `stdio: "inherit"` (so the editor owns the TTY), then
   on exit calls `tui.start()` + `tui.requestRender(true)` to resume pi and force a full
   redraw. This mirrors pi's own built-in external-editor flow.
3. **Exit-code gate.** On exit `0` the buffer is read back and copied. On a non-zero exit
   the clipboard is left untouched (configurable via `PICOPY_REQUIRE_EXIT_ZERO=0`). A
   signal/crash exit (`null`) never copies. Exactly one trailing newline is stripped from
   the buffer before copying.
4. **Cross-platform clipboard write.** pi-copy picks the right tool per platform, spawns
   it, writes the text to its stdin with no extra trailing newline, and awaits exit.
   Failure modes (missing binary, non-zero exit) surface as actionable notifications.

## Architecture

The code intentionally splits **pure, unit-testable** decision logic from the **impure**
I/O seams:

| Module | Role | Purity |
| --- | --- | --- |
| `options.ts` | `readOptions` + `validateOptions` | pure |
| `chord.ts` | double-tap chord state machine | pure |
| `editor.ts` | `resolveEditorCmd` (`PICOPY_EDITOR` > `VISUAL` > `EDITOR`) | pure |
| `clipboard.ts` | tool picker | pure |
| `clipboard.ts` | `copyToClipboard` writer | impure (deps injected) |
| `handler.ts` | orchestrator: TTY handoff, exit gate, copy, notify | impure |
| `index.ts` | factory: read options, validate env, register shortcut + `/picopy` | impure |

All `time`, `spawn`, `fs`, and `which` dependencies are injectable, so the impure seams are
exercised by tests with fakes.

## Source layout

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

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest run
```

Load the in-tree source directly while iterating — no build step, since pi transpiles
TypeScript on the fly via [jiti](https://github.com/unjs/jiti):

```sh
pi -e ./src/index.ts
```

## Manual & dev install

`pi install git:…` (see the [README](../README.md#install)) is the recommended path for
end users. The two options below are for working on a local clone. **Pick one method** —
mixing `pi install` with a manual install will load pi-copy twice (duplicate shortcut
registration, `/picopy` becoming `/picopy:1`).

### Option A — symlink into `~/.pi/agent/extensions/`

```sh
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/src" ~/.pi/agent/extensions/pi-copy
```

pi discovers a subdirectory containing `index.ts` automatically, so
`~/.pi/agent/extensions/pi-copy/index.ts` is picked up at startup. Reload with `/reload`.

### Option B — reference the repo path from `settings.json`

Add the source directory to the `extensions` array in `~/.pi/agent/settings.json` (or the
project-local `.pi/settings.json`):

```json
{
  "extensions": [
    "/absolute/path/to/pi-copy/src"
  ]
}
```

This is the most convenient layout while developing — edit a file, restart pi, done.

> `pi install` writes the separate **`packages`** array (and clones the repo under
> `~/.pi/agent/git/…`), whereas Options A/B use the `extensions` array / discovery dir
> with your live source. They are distinct mechanisms — use only one.
