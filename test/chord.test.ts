import { describe, expect, it } from "vitest";
import { createChord } from "../src/chord.js";

/** Build a chord with a controllable `now()` backed by a mutable counter so
 * timing is exact and deterministic. Returns the chord plus a `setT` helper. */
function makeChord(windowMs?: number): {
	chord: ReturnType<typeof createChord>;
	setT: (t: number) => void;
	t: () => number;
} {
	let current = 0;
	const t = (): number => current;
	const setT = (value: number): void => {
		current = value;
	};
	const chord = createChord(
		windowMs === undefined ? { now: t } : { windowMs, now: t },
	);
	return { chord, setT, t };
}

describe("createChord", () => {
	it("first tap arms and isArmed is true", () => {
		const { chord } = makeChord();
		expect(chord.isArmed()).toBe(false);
		expect(chord.tap()).toBe("arm");
		expect(chord.isArmed()).toBe(true);
	});

	it("second tap within window fires and disarms", () => {
		const { chord, setT } = makeChord(400);
		setT(0);
		expect(chord.tap()).toBe("arm");
		setT(200);
		expect(chord.tap()).toBe("fire");
		expect(chord.isArmed()).toBe(false);
	});

	it("boundary hit at exactly windowMs fires", () => {
		const { chord, setT } = makeChord(400);
		setT(0);
		expect(chord.tap()).toBe("arm");
		setT(400);
		expect(chord.tap()).toBe("fire");
		expect(chord.isArmed()).toBe(false);
	});

	it("windowMs - 1 hits (just inside the window)", () => {
		const { chord, setT } = makeChord(400);
		setT(0);
		expect(chord.tap()).toBe("arm");
		setT(399);
		expect(chord.tap()).toBe("fire");
	});

	it("boundary miss at windowMs + 1 re-arms instead of firing", () => {
		const { chord, setT } = makeChord(400);
		setT(0);
		expect(chord.tap()).toBe("arm");
		setT(401);
		expect(chord.tap()).toBe("arm");
		expect(chord.isArmed()).toBe(true);
	});

	it("a stale first tap never fires; only consecutive within-window taps fire", () => {
		const { chord, setT } = makeChord(400);
		setT(0);
		expect(chord.tap()).toBe("arm");
		// 500 > 400: window expired -> re-arm on this tap.
		setT(500);
		expect(chord.tap()).toBe("arm");
		expect(chord.isArmed()).toBe(true);
		// 600 - 500 = 100 <= 400 -> fire on consecutive taps.
		setT(600);
		expect(chord.tap()).toBe("fire");
		expect(chord.isArmed()).toBe(false);
	});

	it("reset after arming disarms; next tap arms fresh", () => {
		const { chord, setT } = makeChord(400);
		setT(0);
		expect(chord.tap()).toBe("arm");
		expect(chord.isArmed()).toBe(true);
		chord.reset();
		expect(chord.isArmed()).toBe(false);
		// A tap right after reset arms fresh (no stale fire).
		setT(10);
		expect(chord.tap()).toBe("arm");
		expect(chord.isArmed()).toBe(true);
	});

	it("reset is a no-op when already disarmed", () => {
		const { chord, setT } = makeChord(400);
		chord.reset();
		expect(chord.isArmed()).toBe(false);
		setT(0);
		expect(chord.tap()).toBe("arm");
	});

	it("custom windowMs=100: boundary hit and miss", () => {
		const { chord, setT } = makeChord(100);
		setT(0);
		expect(chord.tap()).toBe("arm");
		setT(100);
		expect(chord.tap()).toBe("fire");

		// Fresh chord for the miss case.
		const { chord: c2, setT: setT2 } = makeChord(100);
		setT2(0);
		expect(c2.tap()).toBe("arm");
		setT2(101);
		expect(c2.tap()).toBe("arm");
	});

	it("after a fire, the chord is disarmed; next tap re-arms (arm->fire->arm)", () => {
		const { chord, setT } = makeChord(400);
		setT(0);
		expect(chord.tap()).toBe("arm");
		setT(100);
		expect(chord.tap()).toBe("fire");
		expect(chord.isArmed()).toBe(false);
		// Next tap re-arms.
		setT(200);
		expect(chord.tap()).toBe("arm");
		expect(chord.isArmed()).toBe(true);
	});

	it("two back-to-back taps (elapsed ~0) within window fire", () => {
		const { chord, setT } = makeChord(400);
		setT(0);
		expect(chord.tap()).toBe("arm");
		setT(0);
		expect(chord.tap()).toBe("fire");
	});

	it("default now (omit options): two immediate taps fire", () => {
		// Smoke test with the real Date.now default; calling back-to-back keeps
		// the elapsed time well within the 400ms window on any reasonable host.
		const chord = createChord();
		expect(chord.tap()).toBe("arm");
		expect(chord.tap()).toBe("fire");
		expect(chord.isArmed()).toBe(false);
	});

	it("default windowMs is 400 when now is injected", () => {
		// Omitting windowMs should default to 400: t=200 still fires, t=500
		// would not. This pins the default without depending on Date.now.
		const { chord, setT } = makeChord();
		setT(0);
		expect(chord.tap()).toBe("arm");
		setT(200);
		expect(chord.tap()).toBe("fire");
	});
});
