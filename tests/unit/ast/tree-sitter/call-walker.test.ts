import { describe, expect, it } from "vitest";
import { walkTree, type WalkResult } from "@/ast/tree-sitter/call-walker";

describe("walkTree", () => {
  it("collects node types and text via visitor", () => {
    const visited: Array<{ type: string; text: string }> = [];
    const mockCursor = {
      nodeType: "program",
      nodeText: "const x = 1;",
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 12 },
      gotoFirstChild: () => false,
      gotoNextSibling: () => false,
      gotoParent: () => false,
    };
    const mockTree = { rootNode: { walk: () => mockCursor } };
    walkTree(mockTree as any, {
      enter(nodeType, text) { visited.push({ type: nodeType, text }); },
    });
    expect(visited).toHaveLength(1);
    expect(visited[0].type).toBe("program");
  });
});
