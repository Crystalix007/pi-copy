export interface ChordOptions {
	/** Max milliseconds between the first and second tap. Default 400. */
	windowMs?: number;
	/** Time source, ms since epoch. Default Date.now. Injected in tests. */
	now?: () => number;
}

export type ChordTapResult = "arm" | "fire";

export interface Chord {
	/** Record a key tap. Returns "arm" on the first tap, "fire" on the second
	 * tap within windowMs. */
	tap(): ChordTapResult;
	/** True if a first tap was recorded and we are waiting for the second. */
	isArmed(): boolean;
	/** Forget any armed state (e.g. on timeout, blur, or external cancel). */
	reset(): void;
}

/**
 * A double-tap chord detector.
 *
 * The FIRST tap "arms" (waits for a second tap within `windowMs`); the SECOND
 * tap within the window "fires" and disarms. A tap that arrives AFTER the
 * window expires starts a fresh arm cycle instead of firing — a stale first tap
 * never fires on its own.
 *
 * This exists because pi's `KeyId` is a single key combo with no built-in chord
 * / sequence syntax, so `Ctrl-K Ctrl-K` must be implemented inside a single
 * `ctrl+k` handler as a double-tap state machine (see PLAN.md §2).
 *
 * Boundary rule: a second tap at EXACTLY `windowMs` since the first tap counts
 * as a HIT (fires). `windowMs - 1` hits; `windowMs + 1` re-arms. (Uses `<=`.)
 *
 * PURE / deterministic: the only time source is the injected `now()` (or
 * `Date.now` by default). There are NO timers, NO `process.*` reads, and NO
 * side effects. The chord does NOT manage its own timeout timer — the CP5
 * caller is responsible for clearing its armed status hint on timeout.
 */
export function createChord(options?: ChordOptions): Chord {
	const windowMs = options?.windowMs ?? 400;
	const now = options?.now ?? Date.now;

	let armed = false;
	let lastTapAt = 0;

	return {
		tap(): ChordTapResult {
			const t = now();
			if (!armed) {
				armed = true;
				lastTapAt = t;
				return "arm";
			}
			// Armed: decide fire vs. re-arm based on elapsed time.
			if (t - lastTapAt <= windowMs) {
				armed = false;
				lastTapAt = 0;
				return "fire";
			}
			// Window expired: this tap starts a NEW arm cycle.
			lastTapAt = t;
			return "arm";
		},
		isArmed(): boolean {
			return armed;
		},
		reset(): void {
			armed = false;
			lastTapAt = 0;
		},
	};
}
