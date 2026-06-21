import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { createChord } from "./chord.js";
import { runCopyToClipboard } from "./handler.js";
import { readOptions } from "./options.js";

/**
 * In-flight status-clear timer. Module-scoped so a re-arm while armed, or a
 * fire shortly after an arm, cancels the previously scheduled clear instead of
 * leaking a stale setTimeout that would blank a newer hint.
 */
let statusTimeout: ReturnType<typeof setTimeout> | undefined;

export default function piCopy(pi: ExtensionAPI): void {
	const options = readOptions(
		process.env as Record<string, string | undefined>,
	);
	const chord = createChord({ windowMs: options.windowMs, now: Date.now });

	pi.registerShortcut(options.chordKey as KeyId, {
		description: "Copy via $EDITOR (double-tap)",
		handler: async (ctx) => {
			// Only meaningful in a real terminal.
			if (ctx.mode !== "tui") {
				ctx.ui.notify("pi-copy needs interactive (TUI) mode", "warning");
				return;
			}
			const result = chord.tap();
			if (result === "arm") {
				// Show a hint and auto-clear it after the window so a lone tap
				// does not leave a stale status line.
				ctx.ui.setStatus("picopy", "press Ctrl-K again to copy…");
				if (statusTimeout) clearTimeout(statusTimeout);
				statusTimeout = setTimeout(() => {
					ctx.ui.setStatus("picopy", undefined);
					statusTimeout = undefined;
				}, options.windowMs + 50);
				return;
			}
			// result === "fire"
			if (statusTimeout) {
				clearTimeout(statusTimeout);
				statusTimeout = undefined;
			}
			ctx.ui.setStatus("picopy", undefined);
			await runCopyToClipboard(ctx);
		},
	});

	pi.registerCommand("picopy", {
		description: "Open $EDITOR and copy the result to the clipboard",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("pi-copy needs interactive (TUI) mode", "warning");
				return;
			}
			await runCopyToClipboard(ctx);
		},
	});
}
