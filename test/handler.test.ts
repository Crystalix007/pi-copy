import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { runCopyToClipboard } from "../src/handler.js";

describe("runCopyToClipboard (CP5 stub)", () => {
	it("resolves and notifies once with the stub message", async () => {
		const notify = vi.fn();
		const fakeCtx = {
			ui: { notify },
			mode: "tui",
		} as unknown as ExtensionContext;

		await expect(runCopyToClipboard(fakeCtx)).resolves.toBeUndefined();
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(
			"pi-copy: chord fired (editor launch not wired yet)",
			"info",
		);
	});
});
