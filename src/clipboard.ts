import type { spawn as spawnType } from "node:child_process";

export interface ClipboardTool {
	command: string;
	args: string[];
}

export interface CopyResult {
	ok: boolean;
	error?: string;
}

export interface CopyDeps {
	spawn: typeof spawnType;
	/** Optional presence check. When absent, the writer optimistically assumes
	 * the picked tool exists and surfaces a missing binary via spawn ENOENT. */
	which?: (command: string) => boolean;
}

/**
 * Pick the platform clipboard tool used to WRITE text to the clipboard.
 *
 * PURE: reads only its arguments. Returns `null` if no tool is available for
 * the platform.
 *
 * Selection matrix:
 *   darwin                                  -> pbcopy
 *   win32                                   -> clip.exe
 *   linux + WAYLAND_DISPLAY set (non-empty) -> wl-copy
 *   linux (X or unknown)                    -> xclip -selection clipboard,
 *                                              fallback xsel --clipboard --input
 *   android                                 -> termux-clipboard-set
 *   anything else                           -> null
 *
 * `which` is the caller-supplied binary presence check (returns true if the
 * binary is executable on PATH). It is consulted ONLY for the X branch, where
 * two candidate binaries exist (xclip then xsel). For single-candidate
 * platforms (darwin/win32/wayland/android) the tool is returned WITHOUT calling
 * `which`; the writer will surface a missing binary at spawn time. This keeps
 * the pure signature simple while still resolving the xclip/xsel fallback.
 */
export function pickClipboard(
	platform: NodeJS.Platform,
	env: Record<string, string | undefined>,
	which: (command: string) => boolean,
): ClipboardTool | null {
	switch (platform) {
		case "darwin":
			return { command: "pbcopy", args: [] };
		case "win32":
			return { command: "clip.exe", args: [] };
		case "android":
			return { command: "termux-clipboard-set", args: [] };
		case "linux": {
			const wayland = env.WAYLAND_DISPLAY;
			if (wayland !== undefined && wayland.trim() !== "") {
				return { command: "wl-copy", args: [] };
			}
			// X or unknown: prefer xclip, fall back to xsel.
			if (which("xclip")) {
				return { command: "xclip", args: ["-selection", "clipboard"] };
			}
			if (which("xsel")) {
				return { command: "xsel", args: ["--clipboard", "--input"] };
			}
			return null;
		}
		default:
			// freebsd, openbsd, aix, sunos, cygwin, etc. -> unsupported in v1.
			return null;
	}
}

/**
 * Write `text` to the system clipboard via the picked tool.
 *
 * Spawns the tool, writes `text` (utf-8, NO extra trailing newline) to stdin,
 * closes stdin, and awaits process exit.
 *
 * Returns `{ok:true}` on exit code 0. Returns `{ok:false, error}` on non-zero
 * exit, a spawn error (e.g. ENOENT when the binary is missing), or when no tool
 * is available for the platform. Never throws.
 *
 * Dependency-injected: `spawn` (and optionally `which`) come from `ctx.deps`,
 * so this is unit-testable without a real process. This function does not read
 * `process.*`.
 */
export async function copyToClipboard(
	text: string,
	ctx: {
		platform: NodeJS.Platform;
		env: Record<string, string | undefined>;
		deps: CopyDeps;
	},
): Promise<CopyResult> {
	const which = ctx.deps.which ?? (() => true);
	const tool = pickClipboard(ctx.platform, ctx.env, which);
	if (tool === null) {
		return {
			ok: false,
			error: "no clipboard tool available for this platform",
		};
	}

	return new Promise<CopyResult>((resolve) => {
		let settled = false;
		const finish = (result: CopyResult): void => {
			if (!settled) {
				settled = true;
				resolve(result);
			}
		};

		let child: ReturnType<CopyDeps["spawn"]>;
		try {
			child = ctx.deps.spawn(tool.command, tool.args, {
				stdio: ["pipe", "ignore", "ignore"],
			});
		} catch (e) {
			finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
			return;
		}

		child.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "ENOENT") {
				finish({
					ok: false,
					error: `clipboard tool '${tool.command}' not found`,
				});
			} else {
				finish({ ok: false, error: err.message });
			}
		});

		child.on("close", (code: number | null) => {
			if (code === 0) {
				finish({ ok: true });
			} else {
				finish({
					ok: false,
					error: `${tool.command} exited with code ${code}`,
				});
			}
		});

		const stdin = child.stdin;
		if (stdin === null) {
			// Should not happen with stdio:["pipe",...], but guard for safety.
			finish({ ok: false, error: "clipboard tool has no writable stdin" });
			return;
		}

		// Swallow stdin errors so a premature close never throws unhandled; the
		// process close/error events above are the authority on the result.
		stdin.on("error", () => {
			/* best-effort; resolved via close/error */
		});

		// Write the payload and signal EOF. `end(chunk)` writes the chunk then
		// ends the stream — no trailing newline is appended.
		stdin.end(text, "utf8");
	});
}
