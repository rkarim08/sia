import type { InputEdit, Point } from "./types";

export function computeEdits(oldSource: string, newSource: string): InputEdit[] {
  if (oldSource === newSource) return [];

  const oldLines = oldSource.split("\n");
  const newLines = newSource.split("\n");

  let topMatch = 0;
  while (
    topMatch < oldLines.length &&
    topMatch < newLines.length &&
    oldLines[topMatch] === newLines[topMatch]
  ) {
    topMatch++;
  }

  let oldBottom = oldLines.length - 1;
  let newBottom = newLines.length - 1;
  while (
    oldBottom > topMatch &&
    newBottom > topMatch &&
    oldLines[oldBottom] === newLines[newBottom]
  ) {
    oldBottom--;
    newBottom--;
  }

  const startIndex = byteOffsetForLine(oldLines, topMatch);
  const oldEndIndex = byteOffsetForLine(oldLines, oldBottom + 1);
  const newEndIndex = byteOffsetForLine(newLines, newBottom + 1);

  const startPosition: Point = { row: topMatch, column: 0 };
  const oldEndPosition: Point = { row: oldBottom + 1, column: 0 };
  const newEndPosition: Point = { row: newBottom + 1, column: 0 };

  return [{
    startIndex, oldEndIndex, newEndIndex,
    startPosition, oldEndPosition, newEndPosition,
  }];
}

function byteOffsetForLine(lines: string[], lineIndex: number): number {
  let offset = 0;
  for (let i = 0; i < lineIndex && i < lines.length; i++) {
    offset += Buffer.byteLength(lines[i], "utf-8") + 1;
  }
  return offset;
}
