import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type CentroidState,
	checkSemanticConsistency,
	computeCosineDistance,
	loadCentroid,
	saveCentroid,
	updateCentroid,
} from "@/security/semantic-consistency";

describe("semantic consistency check", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "sia-semantic-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	// ---------------------------------------------------------------
	// updateCentroid
	// ---------------------------------------------------------------

	it("updateCentroid correctly computes running average", () => {
		const state: CentroidState = { centroid: [1, 0, 0], count: 1 };
		const newEmbedding = new Float32Array([0, 1, 0]);

		const updated = updateCentroid(state, newEmbedding);

		expect(updated.centroid[0]).toBeCloseTo(0.5);
		expect(updated.centroid[1]).toBeCloseTo(0.5);
		expect(updated.centroid[2]).toBeCloseTo(0);
		expect(updated.count).toBe(2);

		// Original state must not be mutated
		expect(state.centroid).toEqual([1, 0, 0]);
		expect(state.count).toBe(1);
	});

	// ---------------------------------------------------------------
	// checkSemanticConsistency
	// ---------------------------------------------------------------

	it("checkSemanticConsistency flags vector far from centroid", () => {
		// Orthogonal vectors: cosine distance = 1.0 (> 0.6 threshold)
		const centroid = [1, 0, 0];
		const embedding = new Float32Array([0, 1, 0]);

		const result = checkSemanticConsistency(embedding, centroid);

		expect(result.flagged).toBe(true);
		expect(result.distance).toBeCloseTo(1.0);
	});

	it("checkSemanticConsistency passes vector close to centroid", () => {
		const centroid = [1, 0, 0];
		const embedding = new Float32Array([0.9, 0.1, 0]);

		const result = checkSemanticConsistency(embedding, centroid);

		expect(result.flagged).toBe(false);
		expect(result.distance).toBeLessThan(0.6);
	});

	// ---------------------------------------------------------------
	// loadCentroid / saveCentroid
	// ---------------------------------------------------------------

	it("loadCentroid/saveCentroid round-trip", () => {
		const repoHash = "abc123";
		const state: CentroidState = {
			centroid: [0.5, 0.3, 0.2],
			count: 42,
		};

		saveCentroid(repoHash, state, tempDir);
		const loaded = loadCentroid(repoHash, tempDir);

		expect(loaded).not.toBeNull();
		expect(loaded!.count).toBe(42);
		expect(loaded!.centroid).toEqual([0.5, 0.3, 0.2]);
	});

	it("loadCentroid returns null for missing file", () => {
		const result = loadCentroid("nonexistent-hash", tempDir);
		expect(result).toBeNull();
	});

	// ---------------------------------------------------------------
	// computeCosineDistance
	// ---------------------------------------------------------------

	it("computeCosineDistance returns correct value", () => {
		// Identical vectors: distance = 0
		const a = new Float32Array([1, 0, 0]);
		const b = new Float32Array([1, 0, 0]);
		expect(computeCosineDistance(a, b)).toBeCloseTo(0);

		// Orthogonal vectors: distance = 1
		const c = new Float32Array([1, 0, 0]);
		const d = new Float32Array([0, 1, 0]);
		expect(computeCosineDistance(c, d)).toBeCloseTo(1);

		// Opposite vectors: distance = 2
		const e = new Float32Array([1, 0, 0]);
		const f = new Float32Array([-1, 0, 0]);
		expect(computeCosineDistance(e, f)).toBeCloseTo(2);

		// Known angle: 45 degrees (cos 45 = ~0.707, distance ~0.293)
		const g = new Float32Array([1, 0]);
		const h = new Float32Array([1, 1]);
		const expected = 1 - Math.cos(Math.PI / 4);
		expect(computeCosineDistance(g, h)).toBeCloseTo(expected, 4);
	});
});
