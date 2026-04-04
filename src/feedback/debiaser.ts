// Module: feedback/debiaser — Bayesian Inverse Propensity Scoring (IPS) for position bias correction.
// Reference: Agarwal et al., WSDM 2019 — "Estimating Position Bias without
// Intrusive Interventions" — cascade model priors + Beta posterior update.
//
// Users click top-ranked items regardless of relevance.
// IPS corrects by weighting each click by 1/P(examination|rank).
// Cascade model priors prevent cold-start errors for unseen positions.

/** Minimal feedback event shape needed for debiasing. */
export interface DebiaserEvent {
	rankPosition: number;
	signalStrength: number;
	candidatesShown: number;
}

/**
 * Cascade model examination priors (Agarwal et al., WSDM 2019).
 * P(examination | rank_position) decreasing geometrically from position 0.
 */
const EXAMINATION_PRIOR: Record<number, number> = {
	0: 1.00,
	1: 0.85,
	2: 0.70,
	3: 0.55,
	4: 0.40,
	5: 0.25,
};
const DEFAULT_EXAMINATION_PRIOR = 0.15;

/** Strength of the cascade prior in Beta(alpha, beta) — equivalent to N pseudo-observations. */
const PRIOR_STRENGTH = 5;

function getCascadePrior(position: number): number {
	return EXAMINATION_PRIOR[position] ?? DEFAULT_EXAMINATION_PRIOR;
}

/**
 * Estimate P(examination | rank_position) from historical click data using
 * Bayesian posterior update over cascade model priors.
 */
export function estimateExaminationProbabilities(
	events: DebiaserEvent[],
): Map<number, number> {
	const positiveCounts = new Map<number, number>();
	const totalCounts = new Map<number, number>();

	for (const event of events) {
		const pos = event.rankPosition;
		totalCounts.set(pos, (totalCounts.get(pos) ?? 0) + 1);
		if (event.signalStrength > 0) {
			positiveCounts.set(pos, (positiveCounts.get(pos) ?? 0) + 1);
		}
	}

	const probs = new Map<number, number>();
	for (const [pos, total] of totalCounts) {
		const positive = positiveCounts.get(pos) ?? 0;
		const prior = getCascadePrior(pos);
		const alpha = prior * PRIOR_STRENGTH + positive;
		const betaParam = (1 - prior) * PRIOR_STRENGTH + (total - positive);
		probs.set(pos, alpha / (alpha + betaParam));
	}

	return probs;
}

/**
 * Compute the IPS weight for a feedback event at a given rank position.
 *
 * weight = 1 / P(examination | rank)
 *
 * Clipped to [1/maxWeight, maxWeight] per Strehl et al. (2010).
 * Synthetic events always return 1.0 (no position bias applies).
 */
export function applyIpsWeight(
	rankPosition: number,
	examinationProbs: Map<number, number>,
	maxWeight = 10,
	isSynthetic = false,
): number {
	if (isSynthetic) return 1.0;
	const prob = examinationProbs.get(rankPosition) ?? getCascadePrior(rankPosition);
	const weight = 1 / Math.max(prob, 0.01);
	return Math.min(weight, maxWeight);
}
