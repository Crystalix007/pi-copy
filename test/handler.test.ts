import type { spawn as realSpawn, SpawnOptions } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCopyToClipboard, type LaunchDeps } from "../src/handler.js";

/**
 * The set of clipboard tool commands pickClipboard() can return across all
 * supported platforms. Used to identify which fake-spawn calls are the
 * clipboard write (vs. the editor launch).
 */
const CLIPBOARD_CMDS = new Set([
	"pbcopy",
	"clip.exe",
	"wl-copy",
	"xclip",
	"xsel",
	"termux-clipboard-set",
]);

/**
 * Fake `tui` exposing the three lifecycle methods runEditor() touches. Spies
 * let each test assert the stop/start/requestRender sequence exactly.
 */
interface FakeTui {
	stop: ReturnType<typeof vi.fn>;
	start: ReturnType<typeof vi.fn>;
	requestRender: ReturnType<typeof vi.fn>;
}

function makeFakeTui(): FakeTui {
	return {
		stop: vi.fn(),
		start: vi.fn(),
		requestRender: vi.fn(),
	};
}

interface SpawnCall {
	cmd: string;
	args: string[];
	options: SpawnOptions | undefined;
	/** Captured stdin payload (clipboard write). Empty for editor spawn. */
	stdinData: string;
}

/**
 * Build a fake `spawn` that:
 *   - for an editor invocation (cmd is the resolved editor command) writes
 *     `editorContent` to the tmp file (the last argv element) when
 *     `editorExit` is non-null, then emits `close` with `editorExit`;
 *   - for a clipboard invocation (cmd in CLIPBOARD_CMDS) captures the stdin
 *     payload and emits `close` with `clipboardExit`, OR — when
 *     `clipboardError` is set — emits `error` with that ErrnoException-shaped
 *     object (used to exercise the ENOENT "clipboard tool not found" branch).
 *
 * Returns the recorded calls so tests can assert argv, count, and the
 * clipboard payload. All callbacks fire on the next microtask via
 * `Promise.resolve().then(...)` — no real timers, no flakiness.
 */
function makeFakeSpawn(opts: {
	editorExit: number | null;
	editorContent?: string;
	clipboardExit?: number;
	clipboardError?: { code?: string; message: string };
}): { spawn: LaunchDeps["spawn"]; calls: SpawnCall[] } {
	const calls: SpawnCall[] = [];

	const spawnFn = (
		cmd: string,
		args: readonly string[],
		options: SpawnOptions,
	): ReturnType<typeof realSpawn> => {
		const call: SpawnCall = {
			cmd,
			args: [...args],
			options,
			stdinData: "",
		};
		calls.push(call);

		const closeHandlers: Array<(code: number | null) => void> = [];
		const errorHandlers: Array<(err: Error) => void> = [];

		// Stdin capture for clipboard writes (editor spawn uses stdio:inherit
		// and never writes to stdin; the object is still harmless there).
		const stdin = new Writable({
			write(chunk: Buffer, _enc, cb): void {
				call.stdinData += chunk.toString("utf8");
				cb();
			},
		});

		// An explicit interface breaks the `typeof child` self-reference and
		// satisfies the structural shape clipboard.ts / handler.ts consume.
		interface FakeChild {
			stdin: Writable;
			on(event: string, cb: (...a: unknown[]) => void): FakeChild;
		}
		const child: FakeChild = {
			stdin,
			on(event, cb): FakeChild {
				if (event === "close")
					closeHandlers.push(cb as (code: number | null) => void);
				else if (event === "error")
					errorHandlers.push(cb as (err: Error) => void);
				return child;
			},
		};

		void Promise.resolve().then(() => {
			if (CLIPBOARD_CMDS.has(cmd)) {
				// Clipboard write: succeed, fail per clipboardExit, or surface a
				// spawn-time error per clipboardError (e.g. ENOENT).
				if (opts.clipboardError) {
					const e = Object.assign(new Error(opts.clipboardError.message), {
						code: opts.clipboardError.code,
					});
					for (const cb of errorHandlers) cb(e);
				} else {
					const code = opts.clipboardExit ?? 0;
					for (const cb of closeHandlers) cb(code);
				}
			} else {
				// Editor launch.
				if (opts.editorExit !== null && opts.editorContent !== undefined) {
					const tmpFile = args[args.length - 1];
					void writeFile(tmpFile, opts.editorContent, "utf8").then(() => {
						for (const cb of closeHandlers) cb(opts.editorExit);
					});
				} else {
					for (const cb of closeHandlers) cb(opts.editorExit);
				}
			}
		});

		return child as unknown as ReturnType<typeof realSpawn>;
	};

	return { spawn: spawnFn as unknown as LaunchDeps["spawn"], calls };
}

/**
 * Build a fake ExtensionContext. `ui.custom` invokes the factory with the fake
 * tui and returns a Promise that resolves with whatever `done(value)` was
 * called with — exactly mirroring the real `ctx.ui.custom` lifecycle.
 */
function makeFakeCtx(tui: FakeTui): {
	ctx: ExtensionContext;
	custom: ReturnType<typeof vi.fn>;
	notify: ReturnType<typeof vi.fn>;
} {
	const notify = vi.fn();
	const custom = vi.fn(
		(
			factory: (
				tui: FakeTui,
				theme: unknown,
				kb: unknown,
				done: (result: unknown) => void,
			) => unknown,
		) =>
			new Promise<unknown>((resolve) => {
				const done = (val: unknown): void => {
					resolve(val);
				};
				// Factory returns a Component synchronously (Text); we discard it.
				// The factory kicks off runEditor() async, which eventually calls done.
				factory(tui, {}, {}, done);
			}),
	);
	const ctx = {
		mode: "tui" as const,
		ui: { notify, custom },
	} as unknown as ExtensionContext;
	return { ctx, custom, notify };
}

describe("runCopyToClipboard (CP6)", () => {
	const savedEditor = process.env.EDITOR;
	const savedVisual = process.env.VISUAL;
	const savedPicopyEditor = process.env.PICOPY_EDITOR;
	const savedRequireExitZero = process.env.PICOPY_REQUIRE_EXIT_ZERO;

	beforeEach(() => {
		// Make the editor resolution deterministic for every happy-path test.
		// The fake spawn identifies editor invocations by cmd === "vim".
		process.env.EDITOR = "vim";
		delete process.env.VISUAL;
		delete process.env.PICOPY_EDITOR;
		delete process.env.PICOPY_REQUIRE_EXIT_ZERO;
	});

	afterEach(() => {
		// Restore env exactly.
		if (savedEditor === undefined) delete process.env.EDITOR;
		else process.env.EDITOR = savedEditor;
		if (savedVisual === undefined) delete process.env.VISUAL;
		else process.env.VISUAL = savedVisual;
		if (savedPicopyEditor === undefined) delete process.env.PICOPY_EDITOR;
		else process.env.PICOPY_EDITOR = savedPicopyEditor;
		if (savedRequireExitZero === undefined)
			delete process.env.PICOPY_REQUIRE_EXIT_ZERO;
		else process.env.PICOPY_REQUIRE_EXIT_ZERO = savedRequireExitZero;
	});

	it("happy path: editor exit 0 with content -> tui cycled, clipboard spawned with the text, info notify", async () => {
		const tui = makeFakeTui();
		const { ctx, notify, custom } = makeFakeCtx(tui);
		const fake = makeFakeSpawn({
			editorExit: 0,
			editorContent: "edited text\n",
		});

		// Use the real fs + real tmpdir; only spawn is faked.
		const deps: LaunchDeps = {
			spawn: fake.spawn,
			fs: { writeFile, readFile, unlink },
			tmpdir: () => tmpdir(),
		};

		await runCopyToClipboard(ctx, deps);

		// ctx.ui.custom was invoked exactly once (the tui grab).
		expect(custom).toHaveBeenCalledTimes(1);

		// TTY handoff: stop before spawn, start + requestRender(true) after.
		expect(tui.stop).toHaveBeenCalledTimes(1);
		expect(tui.start).toHaveBeenCalledTimes(1);
		expect(tui.requestRender).toHaveBeenCalledTimes(1);
		expect(tui.requestRender).toHaveBeenCalledWith(true);

		// Two spawn calls: the editor (vim) + the clipboard tool.
		expect(fake.calls).toHaveLength(2);
		const editorCall = fake.calls.find((c) => c.cmd === "vim");
		const clipboardCall = fake.calls.find((c) => CLIPBOARD_CMDS.has(c.cmd));
		expect(editorCall).toBeDefined();
		expect(clipboardCall).toBeDefined();

		// Editor spawn used inherited TTY.
		expect(editorCall?.options).toMatchObject({ stdio: "inherit" });
		// The tmp file path was appended to the editor argv.
		expect(editorCall?.args.at(-1)).toMatch(/pi-copy-[0-9a-f]{12}\.md$/);

		// Clipboard spawn received exactly "edited text" (trailing newline
		// trimmed) via stdin.
		expect(clipboardCall?.stdinData).toBe("edited text");

		// Single info notify with the char count.
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(
			expect.stringMatching(/copied 11 chars to clipboard/),
			"info",
		);
	});

	it("non-zero editor exit (1) -> warning, NO clipboard spawn, tui still restarted", async () => {
		const tui = makeFakeTui();
		const { ctx, notify } = makeFakeCtx(tui);
		const fake = makeFakeSpawn({ editorExit: 1 });

		await runCopyToClipboard(ctx, {
			spawn: fake.spawn,
			fs: { writeFile, readFile, unlink },
			tmpdir: () => tmpdir(),
		});

		// Only the editor spawn; clipboard was NOT called.
		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0]?.cmd).toBe("vim");

		// TUI still got restarted (no leak).
		expect(tui.start).toHaveBeenCalledTimes(1);
		expect(tui.requestRender).toHaveBeenCalledWith(true);

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("editor exited 1"),
			"warning",
		);
		expect(notify.mock.calls[0]?.[0]).toMatch(/clipboard unchanged/);
	});

	it("null editor exit (signal/crash) -> warning 'without status', NO clipboard spawn", async () => {
		const tui = makeFakeTui();
		const { ctx, notify } = makeFakeCtx(tui);
		const fake = makeFakeSpawn({ editorExit: null });

		await runCopyToClipboard(ctx, {
			spawn: fake.spawn,
			fs: { writeFile, readFile, unlink },
			tmpdir: () => tmpdir(),
		});

		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0]?.cmd).toBe("vim");

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("without status"),
			"warning",
		);
		expect(notify.mock.calls[0]?.[0]).toMatch(/clipboard unchanged/);

		// Even after a crash, the TUI is restarted.
		expect(tui.start).toHaveBeenCalledTimes(1);
	});

	it("null exit ignores PICOPY_REQUIRE_EXIT_ZERO=0 (never copies on crash)", async () => {
		process.env.PICOPY_REQUIRE_EXIT_ZERO = "0";
		const tui = makeFakeTui();
		const { ctx, notify } = makeFakeCtx(tui);
		const fake = makeFakeSpawn({ editorExit: null });

		await runCopyToClipboard(ctx, {
			spawn: fake.spawn,
			fs: { writeFile, readFile, unlink },
			tmpdir: () => tmpdir(),
		});

		// No clipboard spawn regardless of the relaxed gate.
		expect(fake.calls).toHaveLength(1);
		expect(notify.mock.calls[0]?.[0]).toMatch(/without status/);
	});

	it("PICOPY_REQUIRE_EXIT_ZERO=0 + editor exit 1 + content -> still copies", async () => {
		process.env.PICOPY_REQUIRE_EXIT_ZERO = "0";
		const tui = makeFakeTui();
		const { ctx, notify } = makeFakeCtx(tui);
		const fake = makeFakeSpawn({
			editorExit: 1,
			editorContent: "saved despite exit 1\n",
		});

		await runCopyToClipboard(ctx, {
			spawn: fake.spawn,
			fs: { writeFile, readFile, unlink },
			tmpdir: () => tmpdir(),
		});

		// Both editor and clipboard spawned.
		expect(fake.calls).toHaveLength(2);
		const clipboardCall = fake.calls.find((c) => CLIPBOARD_CMDS.has(c.cmd));
		expect(clipboardCall?.stdinData).toBe("saved despite exit 1");

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0]?.[0]).toMatch(/copied 20 chars/);
		expect(notify.mock.calls[0]?.[1]).toBe("info");
	});

	it("no editor configured -> error notify, custom NOT called, no spawn", async () => {
		delete process.env.EDITOR;
		delete process.env.VISUAL;
		delete process.env.PICOPY_EDITOR;

		const tui = makeFakeTui();
		const { ctx, notify, custom } = makeFakeCtx(tui);
		const fake = makeFakeSpawn({ editorExit: 0 });

		await runCopyToClipboard(ctx, { spawn: fake.spawn });

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("set $VISUAL or $EDITOR"),
			"error",
		);
		expect(custom).not.toHaveBeenCalled();
		expect(fake.calls).toHaveLength(0);
		expect(tui.stop).not.toHaveBeenCalled();
	});

	it("non-tui mode (print) -> warning notify, custom NOT called, no spawn", async () => {
		const fake = makeFakeSpawn({ editorExit: 0 });
		const ctx = {
			mode: "print" as const,
			ui: {
				notify: vi.fn(),
				custom: vi.fn(),
			},
		} as unknown as ExtensionContext;

		await runCopyToClipboard(ctx, { spawn: fake.spawn });

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("needs interactive"),
			"warning",
		);
		expect(ctx.ui.custom).not.toHaveBeenCalled();
		expect(fake.calls).toHaveLength(0);
	});

	it("cleans up the tmp file after a successful run", async () => {
		const tui = makeFakeTui();
		const { ctx } = makeFakeCtx(tui);
		const fake = makeFakeSpawn({
			editorExit: 0,
			editorContent: "x\n",
		});

		await runCopyToClipboard(ctx, {
			spawn: fake.spawn,
			fs: { writeFile, readFile, unlink },
			tmpdir: () => tmpdir(),
		});

		// The editor spawn's last arg is the tmp file path; it must be gone.
		const tmpFile = fake.calls[0]?.args.at(-1);
		expect(tmpFile).toBeDefined();
		await expect(readFile(tmpFile!, "utf8")).rejects.toThrow();
	});

	it("clipboard write failure -> error notify with the underlying error", async () => {
		const tui = makeFakeTui();
		const { ctx, notify } = makeFakeCtx(tui);
		const fake = makeFakeSpawn({
			editorExit: 0,
			editorContent: "hello\n",
			clipboardExit: 2,
		});

		await runCopyToClipboard(ctx, {
			spawn: fake.spawn,
			fs: { writeFile, readFile, unlink },
			tmpdir: () => tmpdir(),
		});

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0]?.[1]).toBe("error");
		expect(notify.mock.calls[0]?.[0]).toMatch(/clipboard write failed/);
		// Non-ENOENT failures must NOT take the install-hint branch.
		expect(notify.mock.calls[0]?.[0]).not.toMatch(/clipboard tool not found/);
	});

	it("clipboard ENOENT (tool missing) -> actionable 'tool not found' notify with the platform install hint", async () => {
		const tui = makeFakeTui();
		const { ctx, notify } = makeFakeCtx(tui);
		const fake = makeFakeSpawn({
			editorExit: 0,
			editorContent: "hello\n",
			clipboardError: { code: "ENOENT", message: "spawn ENOENT" },
		});

		await runCopyToClipboard(ctx, {
			spawn: fake.spawn,
			fs: { writeFile, readFile, unlink },
			tmpdir: () => tmpdir(),
		});

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0]?.[1]).toBe("error");
		const msg = String(notify.mock.calls[0]?.[0]);
		expect(msg).toMatch(/clipboard tool not found/);
		// Platform-specific install tip is appended. The expected substring
		// depends on the host running the test.
		const expectedHint: RegExp | string =
			process.platform === "darwin"
				? "pbcopy"
				: process.platform === "linux"
					? /wl-copy|xclip/
					: process.platform === "win32"
						? "clip.exe"
						: process.platform === "android"
							? "termux-api"
							: /no clipboard tool/;
		if (expectedHint instanceof RegExp) {
			expect(msg).toMatch(expectedHint);
		} else {
			expect(msg).toContain(expectedHint);
		}
	});
});
