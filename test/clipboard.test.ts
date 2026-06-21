import { Writable } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
	type CopyDeps,
	type CopyResult,
	copyToClipboard,
	pickClipboard,
} from "../src/clipboard.js";

/**
 * Build a fake `spawn` whose child emits the configured outcome on the next
 * tick. Returns the recorded spawn calls plus the captured stdin payload so
 * tests can assert argv and exact bytes written.
 */
function fakeSpawn(opts: {
	exitCode?: number;
	error?: { code: string; message: string };
}): {
	spawn: CopyDeps["spawn"];
	calls: Array<{ cmd: string; args: string[] }>;
	chunks: Buffer[];
} {
	const calls: Array<{ cmd: string; args: string[] }> = [];
	const chunks: Buffer[] = [];
	const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

	const stdin = new Writable({
		write(chunk: Buffer, _enc, cb) {
			chunks.push(Buffer.from(chunk));
			cb();
		},
	});

	const child = {
		stdin,
		on(event: string, cb: (...args: unknown[]) => void) {
			(handlers[event] ??= []).push(cb);
			return child;
		},
	};

	const spawn = (
		cmd: string,
		args: readonly string[],
		_options: unknown,
	): ChildProcess => {
		calls.push({ cmd, args: [...args] });
		process.nextTick(() => {
			if (opts.error) {
				for (const cb of handlers.error ?? []) {
					cb(opts.error);
				}
			} else {
				for (const cb of handlers.close ?? []) {
					cb(opts.exitCode ?? 0);
				}
			}
		});
		return child as unknown as ChildProcess;
	};

	return { spawn: spawn as CopyDeps["spawn"], calls, chunks };
}

describe("pickClipboard", () => {
	it("darwin -> pbcopy with no args", () => {
		expect(pickClipboard("darwin", {}, () => false)).toEqual({
			command: "pbcopy",
			args: [],
		});
	});

	it("does not consult `which` for the single-candidate darwin tool", () => {
		// even when which says "absent", pbcopy is returned (no pre-flight here)
		let called = false;
		const tool = pickClipboard("darwin", {}, () => {
			called = true;
			return false;
		});
		expect(tool).toEqual({ command: "pbcopy", args: [] });
		expect(called).toBe(false);
	});

	it("win32 -> clip.exe with no args", () => {
		expect(pickClipboard("win32", {}, () => false)).toEqual({
			command: "clip.exe",
			args: [],
		});
	});

	it("linux + WAYLAND_DISPLAY set -> wl-copy (no which call)", () => {
		let called = false;
		const tool = pickClipboard(
			"linux",
			{ WAYLAND_DISPLAY: "wayland-0" },
			() => {
				called = true;
				return false;
			},
		);
		expect(tool).toEqual({ command: "wl-copy", args: [] });
		expect(called).toBe(false);
	});

	it("linux no WAYLAND + xclip present -> xclip -selection clipboard", () => {
		const which = (cmd: string) => cmd === "xclip";
		expect(pickClipboard("linux", {}, which)).toEqual({
			command: "xclip",
			args: ["-selection", "clipboard"],
		});
	});

	it("linux no WAYLAND + no xclip + xsel present -> xsel --clipboard --input", () => {
		const which = (cmd: string) => cmd === "xsel";
		expect(pickClipboard("linux", {}, which)).toEqual({
			command: "xsel",
			args: ["--clipboard", "--input"],
		});
	});

	it("linux no WAYLAND + neither xclip nor xsel -> null", () => {
		expect(pickClipboard("linux", {}, () => false)).toBeNull();
	});

	it("linux + whitespace-only WAYLAND_DISPLAY falls through to X branch (xclip)", () => {
		const which = (cmd: string) => cmd === "xclip";
		expect(pickClipboard("linux", { WAYLAND_DISPLAY: "   " }, which)).toEqual({
			command: "xclip",
			args: ["-selection", "clipboard"],
		});
	});

	it("linux + empty WAYLAND_DISPLAY falls through to X branch (xsel fallback)", () => {
		const which = (cmd: string) => cmd === "xsel";
		expect(pickClipboard("linux", { WAYLAND_DISPLAY: "" }, which)).toEqual({
			command: "xsel",
			args: ["--clipboard", "--input"],
		});
	});

	it("android -> termux-clipboard-set", () => {
		expect(pickClipboard("android", {}, () => false)).toEqual({
			command: "termux-clipboard-set",
			args: [],
		});
	});

	it("freebsd -> null (unsupported)", () => {
		expect(pickClipboard("freebsd", {}, () => true)).toBeNull();
	});

	it("openbsd -> null (unsupported)", () => {
		expect(pickClipboard("openbsd", {}, () => true)).toBeNull();
	});
});

describe("copyToClipboard", () => {
	it("happy path: darwin exit 0 -> ok:true, spawns pbcopy [], writes exact text", async () => {
		const fake = fakeSpawn({ exitCode: 0 });
		const result = await copyToClipboard("hello world", {
			platform: "darwin",
			env: {},
			deps: { spawn: fake.spawn },
		});

		expect(result).toEqual({ ok: true });
		expect(fake.calls).toEqual([{ cmd: "pbcopy", args: [] }]);
		expect(fake.chunks.map((c) => c.toString("utf8")).join("")).toBe(
			"hello world",
		);
	});

	it("does not append a trailing newline", async () => {
		const fake = fakeSpawn({ exitCode: 0 });
		await copyToClipboard("plain", {
			platform: "darwin",
			env: {},
			deps: { spawn: fake.spawn },
		});
		const written = fake.chunks.map((c) => c.toString("utf8")).join("");
		expect(written).toBe("plain");
		expect(written.endsWith("\n")).toBe(false);
	});

	it("non-zero exit -> ok:false with code in the error", async () => {
		const fake = fakeSpawn({ exitCode: 1 });
		const result: CopyResult = await copyToClipboard("x", {
			platform: "darwin",
			env: {},
			deps: { spawn: fake.spawn },
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/code 1/);
	});

	it("spawn ENOENT -> ok:false mentioning 'not found'", async () => {
		const fake = fakeSpawn({
			error: { code: "ENOENT", message: "spawn pbcopy ENOENT" },
		});
		const result = await copyToClipboard("x", {
			platform: "darwin",
			env: {},
			deps: { spawn: fake.spawn },
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/not found/);
		expect(result.error).toMatch(/pbcopy/);
	});

	it("spawn ENOENT names the actual tool command", async () => {
		// linux xclip path, which optimistically returns true (absent which)
		const fake = fakeSpawn({
			error: { code: "ENOENT", message: "spawn xclip ENOENT" },
		});
		const result = await copyToClipboard("x", {
			platform: "linux",
			env: {},
			deps: { spawn: fake.spawn },
		});

		expect(result.ok).toBe(false);
		expect(result.error).toBe("clipboard tool 'xclip' not found");
		expect(fake.calls[0]).toEqual({
			cmd: "xclip",
			args: ["-selection", "clipboard"],
		});
	});

	it("non-ENOENT spawn error surfaces the raw message", async () => {
		const fake = fakeSpawn({
			error: { code: "EACCES", message: "permission denied" },
		});
		const result = await copyToClipboard("x", {
			platform: "darwin",
			env: {},
			deps: { spawn: fake.spawn },
		});

		expect(result.ok).toBe(false);
		expect(result.error).toBe("permission denied");
	});

	it("multi-byte text is written to stdin intact", async () => {
		const fake = fakeSpawn({ exitCode: 0 });
		const text = "héllo 世界";
		await copyToClipboard(text, {
			platform: "darwin",
			env: {},
			deps: { spawn: fake.spawn },
		});

		const written = Buffer.concat(fake.chunks);
		expect(written.toString("utf8")).toBe(text);
		expect(written).toEqual(Buffer.from(text, "utf8"));
	});

	it("which undefined still works (optimistic): pick returns a tool, spawn succeeds", async () => {
		// No `which` provided -> picker uses ()=>true -> linux picks xclip.
		const fake = fakeSpawn({ exitCode: 0 });
		const result = await copyToClipboard("optimistic", {
			platform: "linux",
			env: {},
			deps: { spawn: fake.spawn },
		});

		expect(result).toEqual({ ok: true });
		expect(fake.calls[0]).toEqual({
			cmd: "xclip",
			args: ["-selection", "clipboard"],
		});
	});

	it("uses injected which for the X fallback (xsel when xclip absent)", async () => {
		const fake = fakeSpawn({ exitCode: 0 });
		const which = (cmd: string) => cmd === "xsel";
		const result = await copyToClipboard("via-xsel", {
			platform: "linux",
			env: {},
			deps: { spawn: fake.spawn, which },
		});

		expect(result).toEqual({ ok: true });
		expect(fake.calls[0]).toEqual({
			cmd: "xsel",
			args: ["--clipboard", "--input"],
		});
	});

	it("unsupported platform -> ok:false (no spawn attempted)", async () => {
		const fake = fakeSpawn({ exitCode: 0 });
		const result = await copyToClipboard("x", {
			platform: "freebsd",
			env: {},
			deps: { spawn: fake.spawn, which: () => true },
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/no clipboard tool/);
		expect(fake.calls).toEqual([]);
	});

	it("linux with neither xclip nor xsel (real which) -> ok:false, no spawn", async () => {
		const fake = fakeSpawn({ exitCode: 0 });
		const result = await copyToClipboard("x", {
			platform: "linux",
			env: {},
			deps: { spawn: fake.spawn, which: () => false },
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/no clipboard tool/);
		expect(fake.calls).toEqual([]);
	});

	it("writes text then signals EOF (single end call, no separate write)", async () => {
		// The fake records every _write call; end(chunk) produces exactly one.
		const fake = fakeSpawn({ exitCode: 0 });
		await copyToClipboard("abc", {
			platform: "darwin",
			env: {},
			deps: { spawn: fake.spawn },
		});
		expect(fake.chunks).toHaveLength(1);
	});
});
