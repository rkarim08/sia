// Module: time2vec — Time2Vec temporal encoding (Kazemi et al., ICLR 2020)

/**
 * Time2Vec parameters: 1 linear component + 15 periodic components = 16 dimensions.
 * Reference: Kazemi et al., ICLR 2020 — "Time2Vec: Learning to Time"
 */
export interface Time2VecParams {
	/** Weight for the linear (aperiodic) component. */
	linearWeight: number;
	/** Bias for the linear component. */
	linearBias: number;
	/** Weights (frequencies) for the 15 periodic components. */
	periodicWeights: Float32Array;
	/** Phase biases for the 15 periodic components. */
	periodicBiases: Float32Array;
}

/** Output dimension of Time2Vec encoding. */
export const TIME2VEC_DIM = 16;

/**
 * Encode a scalar time value into a 16-dimensional Time2Vec representation.
 *
 * t2v(tau)[0] = w_0 * tau + b_0                  (linear, aperiodic)
 * t2v(tau)[i] = sin(w_i * tau + b_i)  for i > 0  (periodic)
 *
 * The linear term captures monotonic temporal drift (freshness decay).
 * The periodic terms capture recurring patterns (dev cycles, weekly cadence).
 *
 * @param tau - scalar time value, typically log2(1 + daysSinceCapture)
 * @param params - learned or hand-tuned parameters
 * @returns Float32Array of length 16
 */
export function time2vecEncode(tau: number, params: Time2VecParams): Float32Array {
	const output = new Float32Array(TIME2VEC_DIM);

	// Dimension 0: linear (aperiodic)
	output[0] = params.linearWeight * tau + params.linearBias;

	// Dimensions 1-15: periodic (sinusoidal)
	for (let i = 0; i < 15; i++) {
		output[i + 1] = Math.sin(params.periodicWeights[i] * tau + params.periodicBiases[i]);
	}

	return output;
}

/**
 * Create default Time2Vec parameters for bootstrapping.
 * Frequencies are log-spaced to cover different temporal scales:
 * - Low frequencies (0.01-0.1): capture monthly/quarterly patterns
 * - Mid frequencies (0.1-1.0): capture weekly patterns
 * - High frequencies (1.0-10.0): capture daily patterns
 */
export function createDefaultTime2VecParams(): Time2VecParams {
	const periodicWeights = new Float32Array(15);
	const periodicBiases = new Float32Array(15);

	// Log-spaced frequencies from 0.01 to 10.0
	for (let i = 0; i < 15; i++) {
		periodicWeights[i] = 0.01 * 10 ** ((i / 14) * 3);
		periodicBiases[i] = 0; // Zero phase at bootstrap
	}

	return {
		linearWeight: -0.1, // Negative = recency bias (lower score for older)
		linearBias: 0.5, // Center at 0.5
		periodicWeights,
		periodicBiases,
	};
}
