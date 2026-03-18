// Module: fallback-ast-diff — TypeScript fallback for AST diff
// Correctness over performance. For the native/wasm implementation see @sia/native.

import type { AstDiffResult } from "./bridge";

interface AstNode {
	name: string;
	kind: string;
	parent: string | null;
}

function parseTree(bytes: Uint8Array): AstNode[] {
	try {
		const text = new TextDecoder().decode(bytes);
		const parsed = JSON.parse(text) as unknown;
		if (!Array.isArray(parsed)) return [];
		return (parsed as unknown[]).map((item) => {
			const obj = item as Record<string, unknown>;
			return {
				name: String(obj.name ?? ""),
				kind: String(obj.kind ?? ""),
				parent: obj.parent != null ? String(obj.parent) : null,
			};
		});
	} catch {
		return [];
	}
}

/**
 * Name-based AST diff: compares two sets of extracted symbols to detect
 * inserts, removes, updates, and moves.
 *
 * The old/new trees are encoded as JSON arrays of {name, kind, parent} objects.
 * nodeIdMap maps positional indices to stable node IDs (used for removes).
 */
export function fallbackAstDiff(
	oldTreeBytes: Uint8Array,
	newTreeBytes: Uint8Array,
	nodeIdMap: Map<number, string>,
): AstDiffResult {
	const oldNodes = parseTree(oldTreeBytes);
	const newNodes = parseTree(newTreeBytes);

	// Index old nodes by name for O(1) lookup
	const oldByName = new Map<string, { node: AstNode; index: number }[]>();
	for (let i = 0; i < oldNodes.length; i++) {
		const node = oldNodes[i];
		if (!oldByName.has(node.name)) {
			oldByName.set(node.name, []);
		}
		oldByName.get(node.name)?.push({ node, index: i });
	}

	// Index new nodes by name
	const newByName = new Map<string, { node: AstNode; index: number }[]>();
	for (let j = 0; j < newNodes.length; j++) {
		const node = newNodes[j];
		if (!newByName.has(node.name)) {
			newByName.set(node.name, []);
		}
		newByName.get(node.name)?.push({ node, index: j });
	}

	const inserts: AstDiffResult["inserts"] = [];
	const removes: AstDiffResult["removes"] = [];
	const updates: AstDiffResult["updates"] = [];
	const moves: AstDiffResult["moves"] = [];

	// Track which old/new nodes have been matched
	const matchedOld = new Set<number>();
	const matchedNew = new Set<number>();

	// Exact matches first: same name, kind, and parent
	for (const [name, oldEntries] of oldByName) {
		const newEntries = newByName.get(name);
		if (!newEntries) continue;

		for (const oldEntry of oldEntries) {
			for (const newEntry of newEntries) {
				if (matchedOld.has(oldEntry.index) || matchedNew.has(newEntry.index)) continue;
				if (oldEntry.node.kind === newEntry.node.kind) {
					matchedOld.add(oldEntry.index);
					matchedNew.add(newEntry.index);
					// Check for moves (same name+kind but different parent)
					if (oldEntry.node.parent !== newEntry.node.parent) {
						const nodeId = nodeIdMap.get(oldEntry.index) ?? `node-${oldEntry.index}`;
						moves.push({
							node_id: nodeId,
							old_parent: oldEntry.node.parent ?? "",
							new_parent: newEntry.node.parent ?? "",
						});
					}
					break;
				}
			}
		}
	}

	// Partial matches: same name, different kind (update)
	for (const [name, oldEntries] of oldByName) {
		const newEntries = newByName.get(name);
		if (!newEntries) continue;

		for (const oldEntry of oldEntries) {
			if (matchedOld.has(oldEntry.index)) continue;
			for (const newEntry of newEntries) {
				if (matchedNew.has(newEntry.index)) continue;
				// Different kind — treat as an update
				const nodeId = nodeIdMap.get(oldEntry.index) ?? `node-${oldEntry.index}`;
				updates.push({
					node_id: nodeId,
					old_name: oldEntry.node.name,
					new_name: newEntry.node.name,
				});
				matchedOld.add(oldEntry.index);
				matchedNew.add(newEntry.index);
				break;
			}
		}
	}

	// Removes: unmatched old nodes
	for (let i = 0; i < oldNodes.length; i++) {
		if (!matchedOld.has(i)) {
			const nodeId = nodeIdMap.get(i) ?? `node-${i}`;
			removes.push({ node_id: nodeId });
		}
	}

	// Inserts: unmatched new nodes
	for (let j = 0; j < newNodes.length; j++) {
		if (!matchedNew.has(j)) {
			const node = newNodes[j];
			inserts.push({
				node_id: `new-${j}`,
				kind: node.kind,
				name: node.name,
			});
		}
	}

	return { inserts, removes, updates, moves };
}
