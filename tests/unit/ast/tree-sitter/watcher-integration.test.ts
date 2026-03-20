import { describe, expect, it } from "vitest";
import { computeEdits } from "@/ast/tree-sitter/edit-computer";

describe("incremental re-parse", () => {
	it("computeEdits produces valid InputEdit for added line", () => {
		const oldSrc = "function a() {}\nfunction b() {}\n";
		const newSrc = "function a() {}\nfunction c() {}\nfunction b() {}\n";
		const edits = computeEdits(oldSrc, newSrc);
		expect(edits.length).toBeGreaterThan(0);
		expect(edits[0].startPosition.row).toBe(1);
		expect(edits[0].newEndIndex).toBeGreaterThan(edits[0].oldEndIndex);
	});

	it("computeEdits produces valid InputEdit for removed function", () => {
		const oldSrc = "function a() {}\nfunction b() {}\nfunction c() {}\n";
		const newSrc = "function a() {}\nfunction c() {}\n";
		const edits = computeEdits(oldSrc, newSrc);
		expect(edits.length).toBeGreaterThan(0);
		expect(edits[0].oldEndIndex).toBeGreaterThan(edits[0].newEndIndex);
	});
});
