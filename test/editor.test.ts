import { describe, expect, it } from "vitest";
import { resolveEditorCmd, useShellOnSpawn } from "../src/editor.js";

describe("resolveEditorCmd", () => {
	it("PICOPY_EDITOR override beats VISUAL and EDITOR", () => {
		const env = {
			PICOPY_EDITOR: "override-editor",
			VISUAL: "visual-editor",
			EDITOR: "editor-editor",
		};
		expect(resolveEditorCmd(env, "darwin")).toEqual({
			command: "override-editor",
			args: [],
		});
	});

	it("VISUAL beats EDITOR when no override is set", () => {
		const env = {
			VISUAL: "visual-editor",
			EDITOR: "editor-editor",
		};
		expect(resolveEditorCmd(env, "darwin")).toEqual({
			command: "visual-editor",
			args: [],
		});
	});

	it("EDITOR is used when VISUAL is absent", () => {
		const env = { EDITOR: "nano" };
		expect(resolveEditorCmd(env, "darwin")).toEqual({
			command: "nano",
			args: [],
		});
	});

	it("returns null when both VISUAL and EDITOR are unset and no override", () => {
		const env = {};
		expect(resolveEditorCmd(env, "darwin")).toBeNull();
	});

	it("falls through an empty PICOPY_EDITOR override to VISUAL/EDITOR", () => {
		const env = {
			PICOPY_EDITOR: "",
			VISUAL: "visual-editor",
			EDITOR: "editor-editor",
		};
		expect(resolveEditorCmd(env, "darwin")).toEqual({
			command: "visual-editor",
			args: [],
		});
	});

	it("returns null when EDITOR is whitespace-only", () => {
		const env = { EDITOR: "   " };
		expect(resolveEditorCmd(env, "darwin")).toBeNull();
	});

	it("splits a single arg from EDITOR", () => {
		const env = { EDITOR: "code --wait" };
		expect(resolveEditorCmd(env, "darwin")).toEqual({
			command: "code",
			args: ["--wait"],
		});
	});

	it("splits multiple args from EDITOR", () => {
		const env = { EDITOR: "emacs -nw -q" };
		expect(resolveEditorCmd(env, "darwin")).toEqual({
			command: "emacs",
			args: ["-nw", "-q"],
		});
	});

	it("trims leading/trailing whitespace before splitting", () => {
		const env = { EDITOR: "  vim  " };
		expect(resolveEditorCmd(env, "darwin")).toEqual({
			command: "vim",
			args: [],
		});
	});
});

describe("useShellOnSpawn", () => {
	it("returns true on win32", () => {
		expect(useShellOnSpawn("win32")).toBe(true);
	});

	it("returns false on darwin", () => {
		expect(useShellOnSpawn("darwin")).toBe(false);
	});

	it("returns false on linux", () => {
		expect(useShellOnSpawn("linux")).toBe(false);
	});
});
