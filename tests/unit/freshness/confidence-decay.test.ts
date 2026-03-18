import { describe, expect, it } from "vitest";
import {
	type BayesianState,
	bayesianConfidence,
	computeConfidence,
	DECAY_PARAMS,
	getDecayParams,
	recordContradiction,
	recordReObservation,
} from "@/freshness/confidence-decay";

describe("DECAY_PARAMS", () => {
	it("tier2 has Infinity half-life and zero multiplier", () => {
		const p = DECAY_PARAMS.tier2;
		expect(p.halfLifeDays).toBe(Infinity);
		expect(p.decayMultiplier).toBe(0);
		expect(p.reObservationBoost).toBe(0);
	});

	it("Decision has 14-day half-life", () => {
		expect(DECAY_PARAMS.Decision.halfLifeDays).toBe(14);
	});

	it("Bug has 7-day half-life with 1.5× multiplier", () => {
		const p = DECAY_PARAMS.Bug;
		expect(p.halfLifeDays).toBe(7);
		expect(p.decayMultiplier).toBe(1.5);
	});

	it("event has 1/24-day half-life (1 hour)", () => {
		expect(DECAY_PARAMS.event.halfLifeDays).toBeCloseTo(1 / 24, 6);
	});
});

describe("getDecayParams", () => {
	it("returns tier2 params for trust tier 2 regardless of entity type", () => {
		const p = getDecayParams(2, "Function");
		expect(p).toEqual(DECAY_PARAMS.tier2);
	});

	it("returns entity-type-specific params for tier 3 Decision", () => {
		const p = getDecayParams(3, "Decision");
		expect(p).toEqual(DECAY_PARAMS.Decision);
	});

	it("returns tier1_user params for trust tier 1", () => {
		const p = getDecayParams(1, "SomeType");
		expect(p).toEqual(DECAY_PARAMS.tier1_user);
	});

	it("returns tier4_external params for trust tier 4", () => {
		const p = getDecayParams(4, "SomeType");
		expect(p).toEqual(DECAY_PARAMS.tier4_external);
	});

	it("falls back to Decision params for unknown tier 3 entity type", () => {
		const p = getDecayParams(3, "UnknownEntity");
		// Should fall back to a sensible default (Decision or similar)
		expect(p).toBeDefined();
		expect(p.halfLifeDays).toBeGreaterThan(0);
	});
});

describe("computeConfidence — Tier 2 (AST-derived, event-driven)", () => {
	it("stays 1.0 regardless of time when source unchanged", () => {
		expect(computeConfidence(1.0, 2, "Function", 0, undefined, true)).toBe(1.0);
		expect(computeConfidence(1.0, 2, "Function", 30, undefined, true)).toBe(1.0);
		expect(computeConfidence(1.0, 2, "Function", 365, undefined, true)).toBe(1.0);
	});

	it("drops to 0.0 when source has changed", () => {
		expect(computeConfidence(1.0, 2, "Function", 0, undefined, false)).toBe(0.0);
		expect(computeConfidence(1.0, 2, "Function", 100, undefined, false)).toBe(0.0);
	});

	it("treats missing sourceUnchanged as changed (0.0)", () => {
		expect(computeConfidence(1.0, 2, "Function", 0)).toBe(0.0);
	});
});

describe("computeConfidence — Tier 3 (LLM-inferred)", () => {
	it("Decision: ~50% confidence after 14 days (half-life)", () => {
		const result = computeConfidence(1.0, 3, "Decision", 14);
		expect(result).toBeCloseTo(0.5, 2);
	});

	it("Decision: ~100% at day 0", () => {
		const result = computeConfidence(1.0, 3, "Decision", 0);
		expect(result).toBeCloseTo(1.0, 4);
	});

	it("Decision: decays below 50% after 14 days", () => {
		const result = computeConfidence(1.0, 3, "Decision", 20);
		expect(result).toBeLessThan(0.5);
	});

	it("Bug: decays faster than Decision (1.5× multiplier)", () => {
		const bugAt7 = computeConfidence(1.0, 3, "Bug", 7);
		const decisionAt7 = computeConfidence(1.0, 3, "Decision", 7);
		// Bug decays faster, so lower confidence at same time
		expect(bugAt7).toBeLessThan(decisionAt7);
	});

	it("Bug: ~50% at 7 days with 1.5× multiplier applied to 7-day half-life", () => {
		// halfLifeDays=7, multiplier=1.5 → effective half-life = 7/1.5 ≈ 4.67 days
		// At 7 days: e^(-ln2/7 * 1.5 * 7) = e^(-ln2 * 1.5) ≈ 0.354
		const result = computeConfidence(1.0, 3, "Bug", 7);
		expect(result).toBeCloseTo(Math.exp((-Math.LN2 / 7) * 1.5 * 7), 4);
	});

	it("applies Bayesian confidence as min(decay, bayesian)", () => {
		const state: BayesianState = { alpha: 1, beta: 5 }; // bayesian = 1/6 ≈ 0.167
		const result = computeConfidence(1.0, 3, "Decision", 1, state);
		const decayedAlone = computeConfidence(1.0, 3, "Decision", 1);
		// decayed at day 1 is high (close to 1.0), bayesian is low (0.167)
		// min should pick bayesian
		expect(result).toBeLessThan(decayedAlone);
		expect(result).toBeCloseTo(1 / 6, 3);
	});

	it("uses decay when decay < bayesian", () => {
		const state: BayesianState = { alpha: 100, beta: 0 }; // bayesian ≈ 1.0
		const result = computeConfidence(1.0, 3, "Decision", 28); // heavily decayed
		const resultWithBayes = computeConfidence(1.0, 3, "Decision", 28, state);
		// Both should be roughly equal since bayesian is near 1.0
		expect(resultWithBayes).toBeCloseTo(result, 2);
	});

	it("Convention: ~50% after 21 days", () => {
		const result = computeConfidence(1.0, 3, "Convention", 21);
		expect(result).toBeCloseTo(0.5, 2);
	});
});

describe("computeConfidence — Tier 1 (User-stated)", () => {
	it("slow decay: ~50% at effective half-life (halfLifeDays / decayMultiplier = 60 days)", () => {
		// tier1_user: halfLifeDays=30, decayMultiplier=0.5 → effective half-life = 60 days
		const result = computeConfidence(1.0, 1, "SomeType", 60);
		expect(result).toBeCloseTo(0.5, 2);
	});

	it("still high confidence at 7 days", () => {
		const result = computeConfidence(1.0, 1, "SomeType", 7);
		expect(result).toBeGreaterThan(0.8);
	});

	it("does not use Bayesian min for tier 1 (uses decay only)", () => {
		const state: BayesianState = { alpha: 1, beta: 10 }; // low bayesian
		const withBayes = computeConfidence(1.0, 1, "SomeType", 1, state);
		const withoutBayes = computeConfidence(1.0, 1, "SomeType", 1);
		// Tier 1 should use only decay, not min(decay, bayesian)
		expect(withBayes).toBeCloseTo(withoutBayes, 4);
	});
});

describe("computeConfidence — Tier 4 (External)", () => {
	it("fast decay: ~50% at ~2.33 days (7-day half-life × 3× multiplier → effective 2.33 days)", () => {
		// halfLifeDays=7, multiplier=3 → effective half-life = 7/3 ≈ 2.33 days
		const result = computeConfidence(1.0, 4, "SomeType", 7 / 3);
		expect(result).toBeCloseTo(0.5, 2);
	});

	it("decays much faster than tier 1", () => {
		const tier4At5 = computeConfidence(1.0, 4, "SomeType", 5);
		const tier1At5 = computeConfidence(1.0, 1, "SomeType", 5);
		expect(tier4At5).toBeLessThan(tier1At5);
	});
});

describe("computeConfidence — event nodes", () => {
	it("~50% confidence at 1 hour (1/24 day)", () => {
		// Using getDecayParams to get event params; we call with tier 3 + 'event' type
		const result = computeConfidence(1.0, 3, "event", 1 / 24);
		expect(result).toBeCloseTo(0.5, 2);
	});

	it("very low confidence after 2 hours", () => {
		const result = computeConfidence(1.0, 3, "event", 2 / 24);
		expect(result).toBeLessThan(0.3);
	});
});

describe("recordReObservation", () => {
	it("increments alpha by default boost (1)", () => {
		const state: BayesianState = { alpha: 1, beta: 0 };
		const next = recordReObservation(state);
		expect(next.alpha).toBe(2);
		expect(next.beta).toBe(0);
	});

	it("increments alpha by custom boost", () => {
		const state: BayesianState = { alpha: 1, beta: 0 };
		const next = recordReObservation(state, 2);
		expect(next.alpha).toBe(3);
		expect(next.beta).toBe(0);
	});

	it("does not mutate the original state", () => {
		const state: BayesianState = { alpha: 1, beta: 0 };
		recordReObservation(state);
		expect(state.alpha).toBe(1);
	});

	it("multiple re-observations accumulate alpha", () => {
		let state: BayesianState = { alpha: 1, beta: 0 };
		state = recordReObservation(state);
		state = recordReObservation(state);
		state = recordReObservation(state);
		expect(state.alpha).toBe(4);
	});
});

describe("recordContradiction", () => {
	it("increments beta by 1", () => {
		const state: BayesianState = { alpha: 1, beta: 0 };
		const next = recordContradiction(state);
		expect(next.beta).toBe(1);
		expect(next.alpha).toBe(1);
	});

	it("does not mutate the original state", () => {
		const state: BayesianState = { alpha: 1, beta: 0 };
		recordContradiction(state);
		expect(state.beta).toBe(0);
	});

	it("multiple contradictions accumulate beta", () => {
		let state: BayesianState = { alpha: 1, beta: 0 };
		state = recordContradiction(state);
		state = recordContradiction(state);
		expect(state.beta).toBe(2);
	});
});

describe("bayesianConfidence", () => {
	it("returns 1.0 when beta is 0 (alpha=1)", () => {
		expect(bayesianConfidence({ alpha: 1, beta: 0 })).toBe(1.0);
	});

	it("returns 0.5 when alpha equals beta (both 1)", () => {
		expect(bayesianConfidence({ alpha: 1, beta: 1 })).toBe(0.5);
	});

	it("returns alpha/(alpha+beta)", () => {
		expect(bayesianConfidence({ alpha: 3, beta: 1 })).toBeCloseTo(0.75, 4);
		expect(bayesianConfidence({ alpha: 1, beta: 4 })).toBeCloseTo(0.2, 4);
	});

	it("increases after re-observation", () => {
		const initial: BayesianState = { alpha: 1, beta: 1 }; // 0.5
		const afterObs = recordReObservation(initial);
		expect(bayesianConfidence(afterObs)).toBeGreaterThan(bayesianConfidence(initial));
	});

	it("decreases after contradiction", () => {
		const initial: BayesianState = { alpha: 3, beta: 1 }; // 0.75
		const afterContradiction = recordContradiction(initial);
		expect(bayesianConfidence(afterContradiction)).toBeLessThan(bayesianConfidence(initial));
	});
});

describe("combined confidence — min(decay, bayesian) for Tier 3", () => {
	it("bayesian dominates when decay is high but trust is low", () => {
		// Fresh entity (day 0) but many contradictions
		const state: BayesianState = { alpha: 1, beta: 9 }; // bayesian = 0.1
		const result = computeConfidence(1.0, 3, "Decision", 0, state);
		expect(result).toBeCloseTo(0.1, 3);
	});

	it("decay dominates when entity is old but bayesian is high", () => {
		// Old entity (50 days) but high bayesian trust
		const state: BayesianState = { alpha: 100, beta: 0 }; // bayesian ≈ 1.0
		const result = computeConfidence(1.0, 3, "Decision", 50, state);
		// decay at 50 days for Decision: e^(-ln2/14 * 50) ≈ 0.085
		const expected = Math.exp((-Math.LN2 / 14) * 1.0 * 50);
		expect(result).toBeCloseTo(expected, 3);
	});
});
