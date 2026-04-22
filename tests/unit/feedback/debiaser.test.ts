import { describe, expect, it } from "vitest";
import { applyIpsWeight, estimateExaminationProbabilities } from "@/feedback/debiaser";

describe("position bias debiaser", () => {
	it("estimates higher examination probability for top positions", () => {
		const events = [
			// Position 0 clicked 8 times, shown 10 times
			...Array(8).fill({ rankPosition: 0, signalStrength: 1.0, candidatesShown: 10 }),
			...Array(2).fill({ rankPosition: 0, signalStrength: -0.1, candidatesShown: 10 }),
			// Position 5 clicked 2 times, shown 10 times
			...Array(2).fill({ rankPosition: 5, signalStrength: 1.0, candidatesShown: 10 }),
			...Array(8).fill({ rankPosition: 5, signalStrength: -0.1, candidatesShown: 10 }),
		];

		const probs = estimateExaminationProbabilities(events);

		expect(probs.get(0)).toBeGreaterThan(probs.get(5)!);
		expect(probs.get(0)).toBeGreaterThan(0.85);
		expect(probs.get(5)).toBeCloseTo(0.22, 1);
	});

	it("applyIpsWeight returns higher weight for lower-position clicks", () => {
		const probs = new Map([
			[0, 0.9],
			[5, 0.3],
		]);

		const w0 = applyIpsWeight(0, probs);
		const w5 = applyIpsWeight(5, probs);

		expect(w5).toBeGreaterThan(w0);
	});

	it("applyIpsWeight clips to max weight", () => {
		const probs = new Map([[9, 0.01]]);
		const weight = applyIpsWeight(9, probs, 10);
		expect(weight).toBeLessThanOrEqual(10);
	});

	it("applyIpsWeight returns 1.0 for synthetic events regardless of rank", () => {
		const probs = new Map([[5, 0.25]]);
		const weight = applyIpsWeight(5, probs, 10, /* isSynthetic= */ true);
		expect(weight).toBe(1.0);
	});
});
