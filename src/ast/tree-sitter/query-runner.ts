import { readFileSync } from "node:fs";
import type { SiaQueryMatch, SiaQueryCapture } from "./types";

const querySourceCache = new Map<string, string>();

export function loadQuerySource(queryPath: string): string {
  const cached = querySourceCache.get(queryPath);
  if (cached) return cached;
  const source = readFileSync(queryPath, "utf-8");
  querySourceCache.set(queryPath, source);
  return source;
}

export function mapMatchesToSiaMatches(
  rawMatches: Array<{
    pattern: number;
    captures: Array<{
      name: string;
      node: {
        text: string;
        startPosition: { row: number; column: number };
        endPosition: { row: number; column: number };
        startIndex: number;
        endIndex: number;
      };
    }>;
  }>,
): SiaQueryMatch[] {
  return rawMatches.map((match) => ({
    patternIndex: match.pattern,
    captures: match.captures.map(
      (cap): SiaQueryCapture => ({
        name: cap.name,
        text: cap.node.text,
        startPosition: cap.node.startPosition,
        endPosition: cap.node.endPosition,
        startIndex: cap.node.startIndex,
        endIndex: cap.node.endIndex,
      }),
    ),
  }));
}

export function clearQueryCache(): void {
  querySourceCache.clear();
}
