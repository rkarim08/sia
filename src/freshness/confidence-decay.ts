/**
 * confidence-decay.ts — Layer 4 of the freshness engine.
 *
 * Trust-tier-specific confidence decay with Bayesian re-observation reinforcement.
 *
 * Key insight:
 *   - Tier 2 (AST-derived): event-driven invalidation only — no time decay.
 *   - Tier 3 (LLM-inferred): exponential decay × Beta(α,β) Bayesian confidence.
 *   - Tier 1 (User-stated): slow exponential decay, no Bayesian adjustment.
 *   - Tier 4 (External): fast exponential decay, no Bayesian adjustment.
 */

export interface DecayParams {
	halfLifeDays: number;
	decayMultiplier: number;
	reObservationBoost: number; // how much α increments per re-observation
}

/** Decay parameters by trust tier and entity type. */
export const DECAY_PARAMS: Record<string, DecayParams> = {
	tier2: { halfLifeDays: Infinity, decayMultiplier: 0, reObservationBoost: 0 }, // event-driven only
	Decision: { halfLifeDays: 14, decayMultiplier: 1.0, reObservationBoost: 1 },
	Convention: { halfLifeDays: 21, decayMultiplier: 1.0, reObservationBoost: 1 },
	Bug: { halfLifeDays: 7, decayMultiplier: 1.5, reObservationBoost: 1 },
	Solution: { halfLifeDays: 7, decayMultiplier: 1.5, reObservationBoost: 1 },
	Concept: { halfLifeDays: 14, decayMultiplier: 1.0, reObservationBoost: 1 },
	tier1_user: { halfLifeDays: 30, decayMultiplier: 0.5, reObservationBoost: 2 },
	tier4_external: { halfLifeDays: 7, decayMultiplier: 3.0, reObservationBoost: 1 },
	event: { halfLifeDays: 1 / 24, decayMultiplier: 1.0, reObservationBoost: 0 }, // 1 hour
};

/** Default tier-3 decay params used when the entity type is not explicitly listed. */
const TIER3_DEFAULT = DECAY_PARAMS.Decision as DecayParams;

export interface BayesianState {
	alpha: number; // successful re-observations (starts at 1)
	beta: number; // contradictions (starts at 0)
}

/**
 * Get the appropriate decay params for a node given its trust tier and entity type.
 */
export function getDecayParams(trustTier: 1 | 2 | 3 | 4, entityType: string): DecayParams {
	if (trustTier === 2) return DECAY_PARAMS.tier2 as DecayParams;
	if (trustTier === 1) return DECAY_PARAMS.tier1_user as DecayParams;
	if (trustTier === 4) return DECAY_PARAMS.tier4_external as DecayParams;

	// Tier 3 — look up by entity type, fall back to Decision
	return DECAY_PARAMS[entityType] ?? TIER3_DEFAULT;
}

/**
 * Compute current confidence for a node based on its trust tier, type, and age.
 *
 * Tier 2 (AST-derived): binary — 1.0 if source unchanged, 0.0 if changed.
 * Tier 3 (LLM-inferred): exponential decay × Bayesian re-observation (min of both).
 * Tier 1 (User-stated): slow exponential decay only.
 * Tier 4 (External): fast exponential decay only.
 *
 * Formula:
 *   λ = ln(2) / halfLifeDays
 *   decayed = baseConfidence × e^(-λ × decayMultiplier × daysSinceAccess)
 *   bayesian = α / (α + β)
 *   final (tier 3) = min(decayed, bayesian)
 *   final (tier 1/4) = decayed
 *   final (tier 2) = sourceUnchanged ? 1.0 : 0.0
 */
export function computeConfidence(
	baseConfidence: number,
	trustTier: 1 | 2 | 3 | 4,
	entityType: string,
	daysSinceAccess: number,
	bayesian?: BayesianState,
	sourceUnchanged?: boolean,
): number {
	// Tier 2: binary, event-driven
	if (trustTier === 2) {
		return sourceUnchanged === true ? 1.0 : 0.0;
	}

	const params = getDecayParams(trustTier, entityType);

	// Compute exponential decay
	let decayed: number;
	if (params.halfLifeDays === Infinity || params.decayMultiplier === 0 || daysSinceAccess === 0) {
		decayed = baseConfidence;
	} else {
		const lambda = Math.LN2 / params.halfLifeDays;
		decayed = baseConfidence * Math.exp(-lambda * params.decayMultiplier * daysSinceAccess);
	}

	// Tier 3: combine decay with Bayesian state
	if (trustTier === 3 && bayesian !== undefined) {
		const bayes = bayesianConfidence(bayesian);
		return Math.min(decayed, bayes);
	}

	return decayed;
}

/**
 * Record a successful re-observation: increment α by the boost amount.
 * Returns a new BayesianState (does not mutate the original).
 */
export function recordReObservation(state: BayesianState, boost = 1): BayesianState {
	return { alpha: state.alpha + boost, beta: state.beta };
}

/**
 * Record a contradiction: increment β by 1.
 * Returns a new BayesianState (does not mutate the original).
 */
export function recordContradiction(state: BayesianState): BayesianState {
	return { alpha: state.alpha, beta: state.beta + 1 };
}

/**
 * Get the Bayesian confidence: α / (α + β).
 */
export function bayesianConfidence(state: BayesianState): number {
	return state.alpha / (state.alpha + state.beta);
}
