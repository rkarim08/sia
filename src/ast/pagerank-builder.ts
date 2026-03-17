import type { SiaDb } from "@/graph/db-interface";

export interface PageRankResult {
	iterations: number;
	converged: boolean;
	finalDelta: number;
	nodesScored: number;
}

interface EdgeRow {
	from_id: string;
	to_id: string;
}

function buildTeleportVector(nodes: string[], activeFileIds: string[]): Map<string, number> {
	const bias = new Set(activeFileIds ?? []);
	if (bias.size === 0) {
		const uniform = 1 / nodes.length;
		return new Map(nodes.map((id) => [id, uniform]));
	}

	const epsilon = 0.01;
	const activeWeight = (1 - epsilon) / bias.size;
	const passiveWeight = epsilon / nodes.length;
	return new Map(nodes.map((id) => [id, bias.has(id) ? activeWeight : passiveWeight]));
}

export async function computePageRank(
	db: SiaDb,
	activeFileIds: string[] = [],
): Promise<PageRankResult> {
	const { rows } = await db.execute(
		"SELECT from_id, to_id FROM edges WHERE t_valid_until IS NULL AND type IN ('calls','imports','inherits_from')",
	);
	const edges = rows as EdgeRow[];

	const nodes = new Set<string>();
	const outgoing = new Map<string, string[]>();
	const incoming = new Map<string, string[]>();

	for (const edge of edges) {
		nodes.add(edge.from_id);
		nodes.add(edge.to_id);

		if (!outgoing.has(edge.from_id)) outgoing.set(edge.from_id, []);
		outgoing.get(edge.from_id)?.push(edge.to_id);

		if (!incoming.has(edge.to_id)) incoming.set(edge.to_id, []);
		incoming.get(edge.to_id)?.push(edge.from_id);
	}

	if (nodes.size === 0) {
		return { iterations: 0, converged: true, finalDelta: 0, nodesScored: 0 };
	}

	const nodeList = [...nodes];
	const teleport = buildTeleportVector(
		nodeList,
		activeFileIds.filter((id) => nodes.has(id)),
	);
	const damping = 0.85;
	const maxIter = 30;
	const n = nodeList.length;

	let scores = new Map<string, number>(nodeList.map((id) => [id, teleport.get(id) ?? 1 / n]));
	let converged = false;
	let finalDelta = 0;
	let iterationCount = 0;

	for (let iter = 0; iter < maxIter; iter++) {
		iterationCount = iter + 1;
		const newScores = new Map<string, number>();
		const danglingSum = nodeList.reduce((sum, id) => {
			const out = outgoing.get(id);
			return out && out.length > 0 ? sum : sum + (scores.get(id) ?? 0);
		}, 0);

		for (const node of nodeList) {
			const incomingNodes = incoming.get(node) ?? [];
			let rank = danglingSum / n;

			for (const source of incomingNodes) {
				const out = outgoing.get(source) ?? [];
				const weight = out.length === 0 ? 0 : 1 / out.length;
				rank += (scores.get(source) ?? 0) * weight;
			}

			const teleportWeight = teleport.get(node) ?? 1 / n;
			const value = (1 - damping) * teleportWeight + damping * rank;
			newScores.set(node, value);
		}

		let delta = 0;
		for (const node of nodeList) {
			delta += Math.abs((newScores.get(node) ?? 0) - (scores.get(node) ?? 0));
		}
		scores = newScores;
		finalDelta = delta;
		if (delta < 1e-6) {
			converged = true;
			break;
		}
	}

	if (!converged) {
		console.warn(`PageRank did not converge after ${maxIter} iterations (delta=${finalDelta})`);
	}

	const BATCH_SIZE = 500;
	for (let i = 0; i < nodeList.length; i += BATCH_SIZE) {
		const batch = nodeList.slice(i, i + BATCH_SIZE);
		const statements = batch.map((id) => ({
			sql: "UPDATE entities SET importance = ? WHERE id = ?",
			params: [scores.get(id) ?? 0, id],
		}));
		await db.executeMany(statements);
	}

	return {
		iterations: iterationCount,
		converged,
		finalDelta,
		nodesScored: nodeList.length,
	};
}
