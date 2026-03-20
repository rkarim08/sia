import type { NodeVisitor, Point } from "./types";

export interface WalkResult {
	nodesVisited: number;
}

export function walkTree(tree: any, visitor: NodeVisitor): WalkResult {
	const cursor = tree.rootNode.walk();
	let nodesVisited = 0;
	let reachedRoot = false;

	while (!reachedRoot) {
		const nodeType: string = cursor.nodeType;
		const nodeText: string = cursor.nodeText;
		const startPosition: Point = cursor.startPosition;
		const endPosition: Point = cursor.endPosition;

		nodesVisited++;
		const shouldDescend = visitor.enter?.(nodeType, nodeText, startPosition, endPosition);

		if (shouldDescend !== false && cursor.gotoFirstChild()) {
			continue;
		}

		visitor.leave?.(nodeType, nodeText, startPosition, endPosition);

		if (cursor.gotoNextSibling()) {
			continue;
		}

		while (true) {
			if (!cursor.gotoParent()) {
				reachedRoot = true;
				break;
			}
			visitor.leave?.(cursor.nodeType, cursor.nodeText, cursor.startPosition, cursor.endPosition);
			if (cursor.gotoNextSibling()) {
				break;
			}
		}
	}

	return { nodesVisited };
}
