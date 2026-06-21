export type PrefillSource = "none" | "lastAssistant";

export interface PiCopyOptions {
	/** KeyId registered as the chord trigger. Default "ctrl+k". */
	chordKey: string;
	/** Chord double-tap window in ms. Default 400. */
	windowMs: number;
	/** If true (default), only copy to clipboard when $EDITOR exits 0. */
	requireExitZero: boolean;
	/**
	 * Editor command override; when set, wins over $VISUAL/$EDITOR.
	 * Undefined means "honor VISUAL/EDITOR" (the resolver handles it).
	 */
	editorOverride: string | undefined;
	/** What (if anything) to prefill the editor buffer with. Default "none". */
	prefillSource: PrefillSource;
}

/**
 * The documented pi-copy defaults. Reused by `readOptions` for any value that
 * is missing or fails to parse.
 */
export const DEFAULT_OPTIONS: PiCopyOptions = {
	chordKey: "ctrl+k",
	windowMs: 400,
	requireExitZero: true,
	editorOverride: undefined,
	prefillSource: "none",
};

const TRUTHY_REQUIRE = new Set(["true", "1", "yes", "on"]);
const FALSY_REQUIRE = new Set(["false", "0", "no", "off"]);
// Stored lowercase for case-insensitive comparison; mapped back to the
// canonical PrefillSource spelling below.
const VALID_PREFILL: Record<string, PrefillSource> = {
	none: "none",
	lastassistant: "lastAssistant",
};

function parseWindowMs(raw: string): number {
	// Trim, then parse a base-10 integer. A non-numeric, non-positive, or
	// non-finite result falls back to the default. We never throw.
	const n = Number.parseInt(raw.trim(), 10);
	if (!Number.isFinite(n) || n <= 0) {
		return DEFAULT_OPTIONS.windowMs;
	}
	return n;
}

function parseRequireExitZero(raw: string): boolean {
	// Case-insensitive. Recognized truthy/falsy sets win; anything else
	// (including empty string) fails safe to the default (true).
	const v = raw.trim().toLowerCase();
	if (TRUTHY_REQUIRE.has(v)) {
		return true;
	}
	if (FALSY_REQUIRE.has(v)) {
		return false;
	}
	return DEFAULT_OPTIONS.requireExitZero;
}

function parseEditorOverride(raw: string): string | undefined {
	const v = raw.trim();
	return v === "" ? undefined : v;
}

function parseChordKey(raw: string): string {
	const v = raw.trim();
	return v === "" ? DEFAULT_OPTIONS.chordKey : v;
}

function parsePrefillSource(raw: string): PrefillSource {
	// Case-insensitive; must be exactly "none" or "lastAssistant".
	const v = raw.trim().toLowerCase();
	return VALID_PREFILL[v] ?? DEFAULT_OPTIONS.prefillSource;
}

/**
 * Read pi-copy options from an env record. PURE: reads only `env`.
 *
 * Missing or invalid values fall back to the documented defaults and do NOT
 * throw (and do NOT warn to the console — they silently default).
 *
 * Recognized env vars:
 *   PICOPY_KEY               chordKey (default "ctrl+k")
 *   PICOPY_WINDOW_MS         windowMs, integer ms (default 400); invalid -> default
 *   PICOPY_REQUIRE_EXIT_ZERO "true"/"1"/"yes"/"on" -> true;
 *                            "false"/"0"/"no"/"off" -> false; default true
 *   PICOPY_EDITOR            editorOverride (default undefined); empty -> undefined
 *   PICOPY_PREFILL           prefillSource: "none" | "lastAssistant" (default "none")
 */
export function readOptions(
	env: Record<string, string | undefined>,
): PiCopyOptions {
	const windowMsRaw = env.PICOPY_WINDOW_MS;
	const requireRaw = env.PICOPY_REQUIRE_EXIT_ZERO;
	const editorRaw = env.PICOPY_EDITOR;
	const prefillRaw = env.PICOPY_PREFILL;
	const keyRaw = env.PICOPY_KEY;

	return {
		chordKey:
			keyRaw === undefined ? DEFAULT_OPTIONS.chordKey : parseChordKey(keyRaw),
		windowMs:
			windowMsRaw === undefined
				? DEFAULT_OPTIONS.windowMs
				: parseWindowMs(windowMsRaw),
		requireExitZero:
			requireRaw === undefined
				? DEFAULT_OPTIONS.requireExitZero
				: parseRequireExitZero(requireRaw),
		editorOverride:
			editorRaw === undefined ? undefined : parseEditorOverride(editorRaw),
		prefillSource:
			prefillRaw === undefined
				? DEFAULT_OPTIONS.prefillSource
				: parsePrefillSource(prefillRaw),
	};
}

/**
 * Validate env values for pi-copy. PURE: reads only `env` and returns a list
 * of human-readable warning strings (empty when everything is valid or
 * unset). This is the impure-seam caller's signal channel — `readOptions`
 * itself stays silent on invalid values (it just falls back to the default);
 * `validateOptions` is what surfaces typos to the user once at load time.
 *
 * Warning rules (a SET var that is valid, or any UNSET var, produces nothing):
 *   PICOPY_WINDOW_MS         set but not a positive integer
 *       -> "PICOPY_WINDOW_MS='<raw>' is not a positive integer; using 400"
 *   PICOPY_REQUIRE_EXIT_ZERO set but not in the truthy/falsy set
 *       -> "PICOPY_REQUIRE_EXIT_ZERO='<raw>' is not recognized; defaulting to true"
 *   PICOPY_PREFILL           'lastAssistant' (any case)
 *       -> "PICOPY_PREFILL='<raw>' is reserved for a future release; ignored"
 *                            anything other than 'none'/'lastAssistant'
 *       -> "PICOPY_PREFILL='<raw>' is invalid; using 'none'"
 *
 * PICOPY_KEY and PICOPY_EDITOR are free-form strings (any non-empty value is
 * accepted) and never produce a warning here.
 */
export function validateOptions(
	env: Record<string, string | undefined>,
): string[] {
	const warnings: string[] = [];

	const windowMsRaw = env.PICOPY_WINDOW_MS;
	if (windowMsRaw !== undefined) {
		const n = Number.parseInt(windowMsRaw.trim(), 10);
		if (!Number.isFinite(n) || n <= 0) {
			warnings.push(
				`PICOPY_WINDOW_MS='${windowMsRaw}' is not a positive integer; using 400`,
			);
		}
	}

	const requireRaw = env.PICOPY_REQUIRE_EXIT_ZERO;
	if (requireRaw !== undefined) {
		const v = requireRaw.trim().toLowerCase();
		if (!TRUTHY_REQUIRE.has(v) && !FALSY_REQUIRE.has(v)) {
			warnings.push(
				`PICOPY_REQUIRE_EXIT_ZERO='${requireRaw}' is not recognized; defaulting to true`,
			);
		}
	}

	const prefillRaw = env.PICOPY_PREFILL;
	if (prefillRaw !== undefined) {
		const v = prefillRaw.trim().toLowerCase();
		if (v === "lastassistant") {
			warnings.push(
				`PICOPY_PREFILL='${prefillRaw}' is reserved for a future release; ignored`,
			);
		} else if (v !== "none") {
			warnings.push(`PICOPY_PREFILL='${prefillRaw}' is invalid; using 'none'`);
		}
	}

	return warnings;
}
