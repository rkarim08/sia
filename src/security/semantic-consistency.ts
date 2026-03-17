// Module: semantic-consistency — Domain centroid tracking + cosine distance check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SIA_HOME } from "@/shared/config";

/** Running-average state for the domain centroid. */
export interface CentroidState {
	centroid: number[];
	count: number;
}

/**
 * Load the persisted centroid for a repo.
 * Returns null if the centroid file does not exist.
 */
export function loadCentroid(
	repoHash: string,
	siaHome: string = SIA_HOME,
): CentroidState | null {
	const filePath = join(siaHome, "repos", repoHash, "centroid.json");
	if (!existsSync(filePath)) {
		return null;
	}
	const raw = readFileSync(filePath, "utf-8");
	return JSON.parse(raw) as CentroidState;
}

/**
 * Persist the centroid state for a repo.
 * Creates intermediate directories if they do not exist.
 */
export function saveCentroid(
	repoHash: string,
	state: CentroidState,
	siaHome: string = SIA_HOME,
): void {
	const dir = join(siaHome, "repos", repoHash);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const filePath = join(dir, "centroid.json");
	writeFileSync(filePath, JSON.stringify(state), "utf-8");
}

/**
 * Incrementally update the centroid with a new embedding (running average).
 *
 *   new_centroid[i] = (old[i] * n + new[i]) / (n + 1)
 *
 * Returns a new CentroidState; the input is not mutated.
 */
export function updateCentroid(
	state: CentroidState,
	newEmbedding: Float32Array,
): CentroidState {
	const n = state.count;
	const newCentroid: number[] = new Array(state.centroid.length);
	for (let i = 0; i < state.centroid.length; i++) {
		newCentroid[i] = (state.centroid[i] * n + newEmbedding[i]) / (n + 1);
	}
	return { centroid: newCentroid, count: n + 1 };
}

/**
 * Compute cosine distance between two vectors: 1 - cosineSimilarity.
 *
 *   cosineSimilarity = dot(a, b) / (norm(a) * norm(b))
 *   cosineDistance    = 1 - cosineSimilarity
 */
export function computeCosineDistance(
	a: number[] | Float32Array,
	b: number[] | Float32Array,
): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	if (denom === 0) {
		return 1;
	}
	return 1 - dot / denom;
}

/**
 * Check whether an embedding is semantically consistent with the domain centroid.
 * Flags the embedding if cosine distance > 0.6.
 */
export function checkSemanticConsistency(
	embedding: Float32Array,
	centroid: number[],
): { flagged: boolean; distance: number } {
	const distance = computeCosineDistance(embedding, centroid);
	return { flagged: distance > 0.6, distance };
}
