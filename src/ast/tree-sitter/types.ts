/** Which tree-sitter backend is active */
export type TreeSitterBackend = "native" | "wasm" | "unavailable";

/** Position in source code (0-indexed row/column) */
export interface Point {
	row: number;
	column: number;
}

/** A range in the source code */
export interface TreeSitterRange {
	startPosition: Point;
	endPosition: Point;
	startIndex: number;
	endIndex: number;
}

/** A single captured node from a .scm query */
export interface SiaQueryCapture {
	name: string;
	text: string;
	startPosition: Point;
	endPosition: Point;
	startIndex: number;
	endIndex: number;
}

/** A full match from a .scm query (may contain multiple captures) */
export interface SiaQueryMatch {
	patternIndex: number;
	captures: SiaQueryCapture[];
}

/** Tree-sitter InputEdit for incremental re-parsing */
export interface InputEdit {
	startIndex: number;
	oldEndIndex: number;
	newEndIndex: number;
	startPosition: Point;
	oldEndPosition: Point;
	newEndPosition: Point;
}

/** Visitor callbacks for programmatic tree traversal */
export interface NodeVisitor {
	/** Called for each node. Return false to skip children. */
	enter?(
		nodeType: string,
		text: string,
		startPosition: Point,
		endPosition: Point,
	): boolean | undefined;
	/** Called after all children have been visited */
	leave?(nodeType: string, text: string, startPosition: Point, endPosition: Point): void;
}

/**
 * Core tree-sitter service interface.
 * Encapsulates native/WASM duality behind a single API.
 */
export interface ITreeSitterService {
	/** Which backend was loaded: native, wasm, or unavailable */
	readonly backend: TreeSitterBackend;

	parse(source: string, langName: string, previousTree?: unknown): unknown | null;

	query(
		tree: unknown,
		querySchemePath: string,
		startPosition?: Point,
		endPosition?: Point,
	): SiaQueryMatch[];

	walk(tree: unknown, visitor: NodeVisitor): void;

	getChangedRanges(oldTree: unknown, newTree: unknown): TreeSitterRange[];

	dispose(): void;
}
