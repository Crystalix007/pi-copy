export interface ResolvedEditor {
	command: string;
	args: string[];
}

/**
 * Resolve the external editor command string.
 *
 * Precedence (highest wins): `PICOPY_EDITOR` > `VISUAL` > `EDITOR`.
 * Returns `null` if none is set / empty after trim. An empty value at any
 * precedence level is treated as unset and falls through to the next.
 *
 * The chosen command string may include args (e.g. `"code --wait"`); it is
 * split on whitespace into a leading `command` plus the remaining `args`.
 *
 * Limitation (v1): the split is a naive whitespace split — no shell quoting or
 * escaping is handled. An editor path containing spaces or quoted args will be
 * split incorrectly. Acceptable for v1; document for users.
 *
 * This function is PURE: it does not read `process.env` or `process.platform`.
 * The caller passes both, which is what makes it unit-testable.
 */
export function resolveEditorCmd(
	env: Record<string, string | undefined>,
	_platform: NodeJS.Platform,
): ResolvedEditor | null {
	// Precedence (highest wins): PICOPY_EDITOR > VISUAL > EDITOR.
	// A value that is undefined or empty/whitespace-only counts as unset and
	// falls through to the next level.
	const candidates = [env.PICOPY_EDITOR, env.VISUAL, env.EDITOR];
	const raw = candidates.find((c) => c !== undefined && c.trim() !== "");
	if (raw === undefined) {
		return null;
	}

	const tokens = raw.trim().split(/\s+/);
	const [command, ...args] = tokens;
	return { command, args };
}

/**
 * True when the launcher should spawn with `shell: true` (Windows).
 * Used by the CP6 launcher; harmless to export from CP1.
 */
export function useShellOnSpawn(platform: NodeJS.Platform): boolean {
	return platform === "win32";
}
