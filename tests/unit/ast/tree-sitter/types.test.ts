import { describe, expect, it } from "vitest";
import type {
  ITreeSitterService,
  SiaQueryMatch,
  NodeVisitor,
  TreeSitterBackend,
  TreeSitterRange,
  InputEdit,
} from "@/ast/tree-sitter/types";

describe("tree-sitter types", () => {
  it("SiaQueryMatch has required fields", () => {
    const match: SiaQueryMatch = {
      patternIndex: 0,
      captures: [
        {
          name: "function.name",
          text: "myFunc",
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 0, column: 6 },
          startIndex: 0,
          endIndex: 6,
        },
      ],
    };
    expect(match.captures).toHaveLength(1);
    expect(match.captures[0].name).toBe("function.name");
  });

  it("TreeSitterBackend is a valid union", () => {
    const backends: TreeSitterBackend[] = ["native", "wasm", "unavailable"];
    expect(backends).toHaveLength(3);
  });

  it("InputEdit has byte offset and point fields", () => {
    const edit: InputEdit = {
      startIndex: 0,
      oldEndIndex: 10,
      newEndIndex: 15,
      startPosition: { row: 0, column: 0 },
      oldEndPosition: { row: 0, column: 10 },
      newEndPosition: { row: 0, column: 15 },
    };
    expect(edit.startIndex).toBe(0);
  });
});
