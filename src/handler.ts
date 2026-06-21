import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * CP5 stub: proves the chord and /picopy command both reach the handler.
 * CP6 replaces the body with the real editor-launch + clipboard-copy flow.
 */
export async function runCopyToClipboard(ctx: ExtensionContext): Promise<void> {
	ctx.ui.notify("pi-copy: chord fired (editor launch not wired yet)", "info");
}
