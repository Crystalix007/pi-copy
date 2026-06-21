# pi-copy

A small [pi](https://github.com/earendil-works/pi-mono) extension that turns your
`$EDITOR` into a clipboard composition surface.

## Goal

Press `Ctrl-K Ctrl-K` in pi's prompt editor → `$VISUAL` / `$EDITOR` opens on a
scratch buffer → when you quit cleanly (**exit code `0`**), the buffer's contents
are copied to the system clipboard. A non-zero exit leaves the clipboard untouched
and shows a notification.

## Why

A fast, keyboard-driven way to compose or clean up a block of text and get it onto
the clipboard without leaving pi, using the editor you already know.

## Scope (v1)

- Double-tap **`Ctrl-K`** chord triggers the flow (key is configurable).
- Respects `$VISUAL` then `$EDITOR` for the editor command.
- Cross-platform clipboard write:
  - macOS → `pbcopy`
  - Windows → `clip.exe`
  - Linux (X) → `xclip` / `xsel`
  - Linux (Wayland) → `wl-copy`
  - Termux/Android → `termux-clipboard-set`
- Cross-platform editor launch with proper terminal handoff (pause TUI, hand the
  TTY to the editor, resume + full re-render on exit).
- Exit-code gate: copy **only** on exit `0`.

## Out of scope (future enhancements)

- Pre-filling the buffer from pi's output text (last assistant message / last tool
  result / current selection).
- Kill-ring or paste-back integration.
- A persistent history of clipped blocks.
