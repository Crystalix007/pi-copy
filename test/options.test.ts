import { describe, expect, it } from "vitest";
import {
	DEFAULT_OPTIONS,
	readOptions,
	validateOptions,
	type PiCopyOptions,
	type PrefillSource,
} from "../src/options.js";

describe("readOptions defaults", () => {
	it("returns documented defaults when env is empty", () => {
		expect(readOptions({})).toEqual({
			chordKey: "ctrl+k",
			windowMs: 400,
			requireExitZero: true,
			editorOverride: undefined,
			prefillSource: "none",
		});
	});

	it("DEFAULT_OPTIONS matches the all-defaults env result", () => {
		expect(DEFAULT_OPTIONS).toEqual(readOptions({}));
	});
});

describe("PICOPY_KEY -> chordKey", () => {
	it("honors an explicit override", () => {
		expect(readOptions({ PICOPY_KEY: "ctrl+l" }).chordKey).toBe("ctrl+l");
	});

	it("falls back to default on empty string", () => {
		expect(readOptions({ PICOPY_KEY: "" }).chordKey).toBe("ctrl+k");
	});

	it("falls back to default on whitespace-only", () => {
		expect(readOptions({ PICOPY_KEY: "   " }).chordKey).toBe("ctrl+k");
	});

	it("trims surrounding whitespace", () => {
		expect(readOptions({ PICOPY_KEY: "  ctrl+l  " }).chordKey).toBe("ctrl+l");
	});
});

describe("PICOPY_WINDOW_MS -> windowMs", () => {
	it("parses a plain integer string", () => {
		expect(readOptions({ PICOPY_WINDOW_MS: "300" }).windowMs).toBe(300);
	});

	it("trims surrounding whitespace before parsing", () => {
		expect(readOptions({ PICOPY_WINDOW_MS: "  250 " }).windowMs).toBe(250);
	});

	it("falls back to default on zero (non-positive)", () => {
		expect(readOptions({ PICOPY_WINDOW_MS: "0" }).windowMs).toBe(400);
	});

	it("falls back to default on negative", () => {
		expect(readOptions({ PICOPY_WINDOW_MS: "-5" }).windowMs).toBe(400);
	});

	it("falls back to default on non-numeric", () => {
		expect(readOptions({ PICOPY_WINDOW_MS: "abc" }).windowMs).toBe(400);
	});

	it("falls back to default when unset", () => {
		expect(readOptions({}).windowMs).toBe(400);
	});
});

describe("PICOPY_REQUIRE_EXIT_ZERO -> requireExitZero", () => {
	it.each(["true", "1", "yes", "on"])("parses %s (lowercase) as true", (v) => {
		expect(readOptions({ PICOPY_REQUIRE_EXIT_ZERO: v }).requireExitZero).toBe(
			true,
		);
	});

	it.each([
		"TRUE",
		"Yes",
		"ON",
		"1",
	])("parses %s (case-insensitive) as true", (v) => {
		expect(readOptions({ PICOPY_REQUIRE_EXIT_ZERO: v }).requireExitZero).toBe(
			true,
		);
	});

	it.each([
		"false",
		"0",
		"no",
		"off",
	])("parses %s (lowercase) as false", (v) => {
		expect(readOptions({ PICOPY_REQUIRE_EXIT_ZERO: v }).requireExitZero).toBe(
			false,
		);
	});

	it.each([
		"FALSE",
		"No",
		"OFF",
		"0",
	])("parses %s (case-insensitive) as false", (v) => {
		expect(readOptions({ PICOPY_REQUIRE_EXIT_ZERO: v }).requireExitZero).toBe(
			false,
		);
	});

	it("defaults to true when unset", () => {
		expect(readOptions({}).requireExitZero).toBe(true);
	});

	it("fails safe to true on unrecognized value", () => {
		expect(
			readOptions({ PICOPY_REQUIRE_EXIT_ZERO: "maybe" }).requireExitZero,
		).toBe(true);
	});

	it("fails safe to true on empty string", () => {
		expect(readOptions({ PICOPY_REQUIRE_EXIT_ZERO: "" }).requireExitZero).toBe(
			true,
		);
	});
});

describe("PICOPY_EDITOR -> editorOverride", () => {
	it("keeps the raw string (including args)", () => {
		expect(readOptions({ PICOPY_EDITOR: "code --wait" }).editorOverride).toBe(
			"code --wait",
		);
	});

	it("trims surrounding whitespace", () => {
		expect(readOptions({ PICOPY_EDITOR: "  vim  " }).editorOverride).toBe(
			"vim",
		);
	});

	it("becomes undefined on empty string", () => {
		expect(readOptions({ PICOPY_EDITOR: "" }).editorOverride).toBeUndefined();
	});

	it("becomes undefined on whitespace-only", () => {
		expect(
			readOptions({ PICOPY_EDITOR: "   " }).editorOverride,
		).toBeUndefined();
	});

	it("becomes undefined when unset", () => {
		expect(readOptions({}).editorOverride).toBeUndefined();
	});
});

describe("PICOPY_PREFILL -> prefillSource", () => {
	it("parses 'none'", () => {
		expect(readOptions({ PICOPY_PREFILL: "none" }).prefillSource).toBe("none");
	});

	it("parses 'lastAssistant'", () => {
		expect(readOptions({ PICOPY_PREFILL: "lastAssistant" }).prefillSource).toBe(
			"lastAssistant",
		);
	});

	it("parses 'LASTASSISTANT' case-insensitively", () => {
		expect(readOptions({ PICOPY_PREFILL: "LASTASSISTANT" }).prefillSource).toBe(
			"lastAssistant",
		);
	});

	it("falls back to 'none' on an unrecognized value", () => {
		expect(readOptions({ PICOPY_PREFILL: "foo" }).prefillSource).toBe("none");
	});

	it("falls back to 'none' when unset", () => {
		expect(readOptions({}).prefillSource).toBe("none");
	});

	it("falls back to 'none' on empty string", () => {
		expect(readOptions({ PICOPY_PREFILL: "" }).prefillSource).toBe("none");
	});
});

describe("readOptions combinations", () => {
	it("maps each env var independently when all are set", () => {
		const opts = readOptions({
			PICOPY_KEY: "ctrl+;",
			PICOPY_WINDOW_MS: "150",
			PICOPY_REQUIRE_EXIT_ZERO: "off",
			PICOPY_EDITOR: "nano -w",
			PICOPY_PREFILL: "lastAssistant",
		});
		expect(opts).toEqual({
			chordKey: "ctrl+;",
			windowMs: 150,
			requireExitZero: false,
			editorOverride: "nano -w",
			prefillSource: "lastAssistant",
		});
	});

	it("a single valid override leaves the rest at defaults", () => {
		expect(readOptions({ PICOPY_KEY: "ctrl+l" })).toEqual({
			...DEFAULT_OPTIONS,
			chordKey: "ctrl+l",
		});
	});

	it("an invalid value does not corrupt sibling fields", () => {
		const opts = readOptions({
			PICOPY_WINDOW_MS: "garbage",
			PICOPY_REQUIRE_EXIT_ZERO: "garbage",
			PICOPY_PREFILL: "garbage",
			PICOPY_KEY: "ctrl+l",
		});
		expect(opts).toEqual({
			chordKey: "ctrl+l",
			windowMs: DEFAULT_OPTIONS.windowMs,
			requireExitZero: DEFAULT_OPTIONS.requireExitZero,
			editorOverride: DEFAULT_OPTIONS.editorOverride,
			prefillSource: DEFAULT_OPTIONS.prefillSource,
		});
	});
});

describe("option types", () => {
	it("PiCopyOptions and PrefillSource are usable as types", () => {
		const opts: PiCopyOptions = readOptions({});
		const prefill: PrefillSource = opts.prefillSource;
		expect(prefill).toBe("none");
	});
});

describe("validateOptions", () => {
	it("returns no warnings for an empty env", () => {
		expect(validateOptions({})).toEqual([]);
	});

	it("returns no warnings when every var is set and valid", () => {
		expect(
			validateOptions({
				PICOPY_KEY: "ctrl+l",
				PICOPY_WINDOW_MS: "300",
				PICOPY_REQUIRE_EXIT_ZERO: "false",
				PICOPY_EDITOR: "vim",
				PICOPY_PREFILL: "none",
			}),
		).toEqual([]);
	});

	it("returns no warnings when only some vars are set and valid", () => {
		expect(validateOptions({ PICOPY_WINDOW_MS: "100" })).toEqual([]);
	});

	it("never warns for the free-form PICOPY_KEY / PICOPY_EDITOR values", () => {
		expect(
			validateOptions({ PICOPY_KEY: "anything", PICOPY_EDITOR: "anything" }),
		).toEqual([]);
	});

	describe("PICOPY_WINDOW_MS", () => {
		it("warns on non-numeric", () => {
			expect(validateOptions({ PICOPY_WINDOW_MS: "abc" })).toEqual([
				"PICOPY_WINDOW_MS='abc' is not a positive integer; using 400",
			]);
		});

		it("warns on zero", () => {
			expect(validateOptions({ PICOPY_WINDOW_MS: "0" })).toEqual([
				"PICOPY_WINDOW_MS='0' is not a positive integer; using 400",
			]);
		});

		it("warns on negative", () => {
			expect(validateOptions({ PICOPY_WINDOW_MS: "-5" })).toEqual([
				"PICOPY_WINDOW_MS='-5' is not a positive integer; using 400",
			]);
		});

		it("preserves the raw value (including whitespace) in the message", () => {
			expect(validateOptions({ PICOPY_WINDOW_MS: "  junk " })).toEqual([
				"PICOPY_WINDOW_MS='  junk ' is not a positive integer; using 400",
			]);
		});

		it("does not warn on a positive integer", () => {
			expect(validateOptions({ PICOPY_WINDOW_MS: "400" })).toEqual([]);
		});

		it("does not warn on a positive integer with surrounding whitespace", () => {
			expect(validateOptions({ PICOPY_WINDOW_MS: "  250 " })).toEqual([]);
		});
	});

	describe("PICOPY_REQUIRE_EXIT_ZERO", () => {
		it("warns on an unrecognized value", () => {
			expect(validateOptions({ PICOPY_REQUIRE_EXIT_ZERO: "maybe" })).toEqual([
				"PICOPY_REQUIRE_EXIT_ZERO='maybe' is not recognized; defaulting to true",
			]);
		});

		it("warns on empty string", () => {
			expect(validateOptions({ PICOPY_REQUIRE_EXIT_ZERO: "" })).toEqual([
				"PICOPY_REQUIRE_EXIT_ZERO='' is not recognized; defaulting to true",
			]);
		});

		it.each([
			"true",
			"1",
			"yes",
			"on",
			"TRUE",
			"Yes",
		])("does not warn on truthy %s", (v) => {
			expect(validateOptions({ PICOPY_REQUIRE_EXIT_ZERO: v })).toEqual([]);
		});

		it.each([
			"false",
			"0",
			"no",
			"off",
			"FALSE",
			"No",
		])("does not warn on falsy %s", (v) => {
			expect(validateOptions({ PICOPY_REQUIRE_EXIT_ZERO: v })).toEqual([]);
		});
	});

	describe("PICOPY_PREFILL", () => {
		it("warns that 'lastAssistant' is reserved (not implemented in v1)", () => {
			expect(validateOptions({ PICOPY_PREFILL: "lastAssistant" })).toEqual([
				"PICOPY_PREFILL='lastAssistant' is reserved for a future release; ignored",
			]);
		});

		it("warns that 'LASTASSISTANT' (case-insensitive) is reserved", () => {
			expect(validateOptions({ PICOPY_PREFILL: "LASTASSISTANT" })).toEqual([
				"PICOPY_PREFILL='LASTASSISTANT' is reserved for a future release; ignored",
			]);
		});

		it("warns on an unrecognized value", () => {
			expect(validateOptions({ PICOPY_PREFILL: "foo" })).toEqual([
				"PICOPY_PREFILL='foo' is invalid; using 'none'",
			]);
		});

		it("warns on empty string", () => {
			expect(validateOptions({ PICOPY_PREFILL: "" })).toEqual([
				"PICOPY_PREFILL='' is invalid; using 'none'",
			]);
		});

		it("does not warn on 'none'", () => {
			expect(validateOptions({ PICOPY_PREFILL: "none" })).toEqual([]);
		});

		it("does not warn on 'NONE' (case-insensitive)", () => {
			expect(validateOptions({ PICOPY_PREFILL: "NONE" })).toEqual([]);
		});
	});

	describe("multiple warnings", () => {
		it("returns one warning per invalid var, in env-var order", () => {
			const w = validateOptions({
				PICOPY_WINDOW_MS: "abc",
				PICOPY_REQUIRE_EXIT_ZERO: "maybe",
				PICOPY_PREFILL: "foo",
			});
			expect(w).toEqual([
				"PICOPY_WINDOW_MS='abc' is not a positive integer; using 400",
				"PICOPY_REQUIRE_EXIT_ZERO='maybe' is not recognized; defaulting to true",
				"PICOPY_PREFILL='foo' is invalid; using 'none'",
			]);
		});
	});
});
