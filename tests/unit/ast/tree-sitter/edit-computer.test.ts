import { describe, expect, it } from "vitest";
import { computeEdits } from "@/ast/tree-sitter/edit-computer";

describe("computeEdits", () => {
	it("returns empty array for identical sources", () => {
		const edits = computeEdits("const a = 1;", "const a = 1;");
		expect(edits).toEqual([]);
	});

	it("detects a single line insertion", () => {
		const oldSrc = "line1\nline2\n";
		const newSrc = "line1\nnewline\nline2\n";
		const edits = computeEdits(oldSrc, newSrc);
		expect(edits.length).toBeGreaterThan(0);
		const edit = edits[0];
		expect(edit.startIndex).toBeGreaterThanOrEqual(0);
		expect(edit.newEndIndex).toBeGreaterThan(edit.oldEndIndex);
		expect(edit.startPosition.row).toBeGreaterThanOrEqual(0);
	});

	it("detects a single line deletion", () => {
		const oldSrc = "line1\nline2\nline3\n";
		const newSrc = "line1\nline3\n";
		const edits = computeEdits(oldSrc, newSrc);
		expect(edits.length).toBeGreaterThan(0);
		expect(edits[0].oldEndIndex).toBeGreaterThan(edits[0].newEndIndex);
	});

	it("detects a modification within a line", () => {
		const oldSrc = "const a = 1;\n";
		const newSrc = "const a = 42;\n";
		const edits = computeEdits(oldSrc, newSrc);
		expect(edits.length).toBeGreaterThan(0);
	});

	it("handles multiline changes", () => {
		const oldSrc = "function foo() {\n  return 1;\n}\n";
		const newSrc = "function foo() {\n  const x = 2;\n  return x;\n}\n";
		const edits = computeEdits(oldSrc, newSrc);
		expect(edits.length).toBeGreaterThan(0);
	});
});
