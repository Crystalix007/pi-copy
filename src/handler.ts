import { spawn, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, type TUI } from "@earendil-works/pi-tui";
import { copyToClipboard } from "./clipboard.js";
import { resolveEditorCmd, type ResolvedEditor } from "./editor.js";
import { readOptions } from "./options.js";

/**
 * Injectable seams for `runCopyToClipboard` so the orchestration can be unit
 * tested without a real terminal or real child processes. The real call site
 * (`src/index.ts`) passes nothing — `deps = {}` falls back to the real
 * `spawn`, the real `fs/promises`, and the real `os.tmpdir`.
 *
 * `spawn` is shared by the editor launch AND the clipboard write so a single
 * fake can drive both in tests.
 */
export interface LaunchDeps {
	/** Override the real spawn (tests inject a fake). */
	spawn?: typeof spawn;
	/** Override the real fs/promises (tests inject a fake). */
	fs?: {
		writeFile: typeof writeFile;
		readFile: typeof readFile;
		unlink: typeof unlink;
	};
	/** Override os.tmpdir() (tests inject). */
	tmpdir?: () => string;
}

interface EditorResult {
	exitCode: number | null;
	content: string | null;
}

/**
 * Open `$VISUAL`/`$EDITOR` on an empty tmp file with proper TTY handoff, then
 * on a clean exit copy the buffer to the system clipboard. A non-zero or null
 * (signal/crash) exit leaves the clipboard untouched — configurable via
 * `PICOPY_REQUIRE_EXIT_ZERO=0` to still copy on a non-zero-but-not-null exit;
 * a null exit (signal/crash) is never copied regardless.
 *
 * TTY handoff mirrors pi's own `ExtensionEditorComponent#openExternalEditor`:
 * `tui.stop()` BEFORE awaiting spawn, `tui.start()` + `requestRender(true)`
 * AFTER (in both success and error paths). NEVER uses `spawnSync` — on Windows
 * it keeps libuv's console-input read alive after `tui.stop()`, racing vim for
 * the input buffer.
 */
export async function runCopyToClipboard(
	ctx: ExtensionContext,
	deps: LaunchDeps = {},
): Promise<void> {
	// 1. Mode guard — needs a real terminal.
	if (ctx.mode !== "tui") {
		ctx.ui.notify("pi-copy needs interactive (TUI) mode", "warning");
		return;
	}

	// 2. Resolve editor from env.
	const resolved = resolveEditorCmd(
		process.env as Record<string, string | undefined>,
		process.platform,
	);
	if (resolved === null) {
		ctx.ui.notify("pi-copy: set $VISUAL or $EDITOR", "error");
		return;
	}

	// 3. Grab the TUI via ctx.ui.custom and run the editor.
	//    The factory MUST return a Component synchronously; the async work
	//    (write tmp -> stop TUI -> spawn editor -> start TUI -> read tmp)
	//    happens via the `.then(done)` chain, and `done(result)` resolves the
	//    outer `ctx.ui.custom` Promise with the EditorResult.
	const launchResult = await ctx.ui.custom<EditorResult>(
		(tui, _theme, _kb, done) => {
			const component = new Text("Launching $EDITOR…", 0, 0);
			void runEditor(tui, resolved, deps)
				.then(done)
				.catch((err: unknown) => {
					console.error("pi-copy editor launch failed:", err);
					done({ exitCode: null, content: null });
				});
			return component;
		},
	);

	// 4. Exit-code gate. A null exit (signal/crash) NEVER copies.
	const options = readOptions(
		process.env as Record<string, string | undefined>,
	);
	const allowExit =
		launchResult.exitCode === 0 ||
		(!options.requireExitZero && launchResult.exitCode !== null);
	if (!allowExit) {
		ctx.ui.notify(
			`pi-copy: editor exited ${launchResult.exitCode ?? "without status"}, clipboard unchanged`,
			"warning",
		);
		return;
	}

	// 5. Content gate.
	if (launchResult.content === null) {
		ctx.ui.notify("pi-copy: no content read", "warning");
		return;
	}

	// 6. Copy.
	const content = launchResult.content;
	const result = await copyToClipboard(content, {
		platform: process.platform,
		env: process.env as Record<string, string | undefined>,
		deps: { spawn: deps.spawn ?? spawn, which: undefined },
	});
	if (result.ok) {
		ctx.ui.notify(
			`pi-copy: copied ${content.length} chars to clipboard`,
			"info",
		);
	} else {
		ctx.ui.notify(
			`pi-copy: clipboard write failed: ${result.error ?? "unknown error"}`,
			"error",
		);
	}
}

/**
 * Module-scoped editor launch helper. Performs the TTY handoff:
 *
 *   write empty tmp file
 *   tui.stop()
 *   spawn editor (async, stdio: inherit, shell on Windows)
 *   await close code
 *   tui.start() + tui.requestRender(true)
 *   read tmp content (trimmed of a single trailing newline, like pi)
 *
 * `tui.start()` runs in BOTH success and error paths: once after the spawn
 * resolves, and again in the catch if anything in between threw. The tmp file
 * is always unlinked in `finally` (errors ignored).
 */
async function runEditor(
	tui: TUI,
	resolved: ResolvedEditor,
	deps: LaunchDeps,
): Promise<EditorResult> {
	const doFs = deps.fs ?? { writeFile, readFile, unlink };
	const doSpawn = deps.spawn ?? spawn;
	const dir = deps.tmpdir ?? tmpdir;
	const tmpFile = join(dir(), `pi-copy-${randomBytes(6).toString("hex")}.md`);
	try {
		await doFs.writeFile(tmpFile, "", "utf8");
		process.stdout.write(`Launching ${resolved.command}…\n`);
		tui.stop();
		const exitCode = await new Promise<number | null>((resolve) => {
			// `SpawnOptions` (not `SpawnOptionsWithoutStdio`) because the latter
			// narrows stdio to pipes only, which excludes the "inherit" we need.
			const child = doSpawn(resolved.command, [...resolved.args, tmpFile], {
				stdio: "inherit",
				shell: process.platform === "win32",
			} satisfies SpawnOptions);
			child.on("error", () => resolve(null));
			child.on("close", (code: number | null) => resolve(code));
		});
		tui.start();
		tui.requestRender(true);
		// Read the content for any non-null exit so PICOPY_REQUIRE_EXIT_ZERO=0
		// can still copy on a non-zero editor exit (a null/signal exit never
		// copies regardless of the option).
		let content: string | null = null;
		if (exitCode !== null) {
			try {
				const raw = await doFs.readFile(tmpFile, "utf8");
				// Trim a single trailing newline like pi's reference does.
				content = raw.replace(/\n$/, "");
			} catch {
				// Read failed; content stays null and the "no content read"
				// warning surfaces in runCopyToClipboard.
			}
		}
		return { exitCode, content };
	} catch {
		// Ensure tui restarts even on an unexpected throw.
		try {
			tui.start();
			tui.requestRender(true);
		} catch {
			// best-effort; nothing more we can do.
		}
		return { exitCode: null, content: null };
	} finally {
		try {
			await doFs.unlink(tmpFile);
		} catch {
			// Ignore cleanup errors (file may not exist, EBUSY, etc.).
		}
	}
}
