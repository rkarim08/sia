import { describe, expect, it } from "vitest";
import { loadQuerySource, mapMatchesToSiaMatches } from "@/ast/tree-sitter/query-runner";

describe("loadQuerySource", () => {
  it("throws for nonexistent query file", () => {
    expect(() => loadQuerySource("/nonexistent/symbols.scm")).toThrow();
  });
});

describe("mapMatchesToSiaMatches", () => {
  it("maps raw matches to SiaQueryMatch format", () => {
    const rawMatches = [
      {
        pattern: 0,
        captures: [
          {
            name: "name",
            node: {
              text: "myFunc",
              startPosition: { row: 0, column: 9 },
              endPosition: { row: 0, column: 15 },
              startIndex: 9,
              endIndex: 15,
            },
          },
        ],
      },
    ];
    const result = mapMatchesToSiaMatches(rawMatches);
    expect(result).toHaveLength(1);
    expect(result[0].patternIndex).toBe(0);
    expect(result[0].captures[0].name).toBe("name");
    expect(result[0].captures[0].text).toBe("myFunc");
    expect(result[0].captures[0].startIndex).toBe(9);
  });

  it("handles empty matches array", () => {
    expect(mapMatchesToSiaMatches([])).toEqual([]);
  });
});
