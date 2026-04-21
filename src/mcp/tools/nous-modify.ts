// Module: mcp/tools/nous-modify — gated Preference node creation/update/deprecation
//
// This is the self-modification surface. It is gated three ways:
//   1. Blocked entirely for non-primary sessions (subagents, worktrees).
//   2. Blocked when the session's drift score exceeds selfModifyBlockThreshold
//      (or when nousModifyBlocked is latched true on state).
//   3. Update/deprecate actions on Tier 1 Preferences return
//      `confirmationRequired: true` and do NOT mutate the graph — the caller
//      (developer) must explicitly re-invoke with a fresh intent.

import { v4 as uuid } from "uuid";
import type { SiaDb } from "@/graph/db-interface";
import { DEFAULT_NOUS_CONFIG } from "@/nous/types";
import { getSession } from "@/nous/working-memory";

export interface ModifyInput {
	action: "create" | "update" | "deprecate";
	preference: string;
	reason: string;
	existingNodeId?: string;
}

export interface ModifyResult {
	blocked: boolean;
	blockReason?: string;
	newNodeId?: string;
	supersededNodeId?: string;
	confirmationRequired?: boolean;
}

export async function handleNousModify(
	db: SiaDb,
	sessionId: string,
	input: ModifyInput,
): Promise<ModifyResult> {
	const config = DEFAULT_NOUS_CONFIG;
	const session = getSession(db, sessionId);

	if (!session) {
		return { blocked: true, blockReason: "No active session found" };
	}

	// Gate 1: subagents and worktrees blocked.
	if (session.session_type !== "primary") {
		return {
			blocked: true,
			blockReason: `nous_modify is blocked for subagent sessions (session_type=${session.session_type})`,
		};
	}

	// Gate 2: drift too high.
	if (
		session.state.nousModifyBlocked ||
		session.state.driftScore > config.selfModifyBlockThreshold
	) {
		return {
			blocked: true,
			blockReason: `nous_modify blocked: drift score ${session.state.driftScore.toFixed(2)} exceeds threshold ${config.selfModifyBlockThreshold}`,
		};
	}

	// Gate 3: reason must be non-empty.
	if (!input.reason || input.reason.trim().length === 0) {
		return {
			blocked: true,
			blockReason: "nous_modify requires a non-empty `reason`",
		};
	}

	const raw = db.rawSqlite();
	if (!raw) {
		return {
			blocked: true,
			blockReason: "nous_modify requires a bun:sqlite-backed SiaDb",
		};
	}

	const now = Date.now();
	const nowSec = Math.floor(now / 1000);

	if (input.action === "create") {
		const newId = uuid();
		raw.prepare(
			`INSERT INTO graph_nodes (
				id, type, name, content, summary,
				tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance,
				access_count, edge_count,
				last_accessed, created_at, t_created,
				visibility, created_by,
				kind,
				captured_by_session_id, captured_by_session_type
			) VALUES (
				?, 'Preference', ?, ?, ?,
				'[]', '[]',
				3, 0.8, 0.8,
				0.6, 0.6,
				0, 0,
				?, ?, ?,
				'private', 'nous-modify',
				'Preference',
				?, ?
			)`,
		).run(
			newId,
			input.preference.slice(0, 100),
			input.preference,
			`${input.preference.slice(0, 80)} — ${input.reason.slice(0, 60)}`,
			now,
			now,
			now,
			sessionId,
			session.session_type,
		);
		return { blocked: false, newNodeId: newId };
	}

	if (input.action === "update") {
		if (!input.existingNodeId) {
			return {
				blocked: true,
				blockReason: "update action requires existingNodeId",
			};
		}
		const existing = raw
			.prepare("SELECT trust_tier FROM graph_nodes WHERE id = ? AND kind = 'Preference'")
			.get(input.existingNodeId) as { trust_tier: number } | undefined;

		if (!existing) {
			return {
				blocked: true,
				blockReason: `Preference node ${input.existingNodeId} not found`,
			};
		}

		// Tier 1 preferences require explicit developer confirmation — DO NOT mutate yet.
		if (existing.trust_tier === 1) {
			return {
				blocked: false,
				confirmationRequired: true,
				supersededNodeId: input.existingNodeId,
			};
		}

		// Supersede the old node — set t_valid_until and t_expired.
		raw.prepare(
			"UPDATE graph_nodes SET t_valid_until = ?, t_expired = ? WHERE id = ?",
		).run(now, now, input.existingNodeId);

		const newId = uuid();
		raw.prepare(
			`INSERT INTO graph_nodes (
				id, type, name, content, summary,
				tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance,
				access_count, edge_count,
				last_accessed, created_at, t_created,
				visibility, created_by,
				kind,
				captured_by_session_id, captured_by_session_type
			) VALUES (
				?, 'Preference', ?, ?, ?,
				'[]', '[]',
				3, 0.8, 0.8,
				0.6, 0.6,
				0, 0,
				?, ?, ?,
				'private', 'nous-modify',
				'Preference',
				?, ?
			)`,
		).run(
			newId,
			input.preference.slice(0, 100),
			input.preference,
			`${input.preference.slice(0, 80)} — updated: ${input.reason.slice(0, 60)}`,
			now,
			now,
			now,
			sessionId,
			session.session_type,
		);

		return {
			blocked: false,
			newNodeId: newId,
			supersededNodeId: input.existingNodeId,
		};
	}

	if (input.action === "deprecate") {
		if (!input.existingNodeId) {
			return {
				blocked: true,
				blockReason: "deprecate action requires existingNodeId",
			};
		}
		const existing = raw
			.prepare("SELECT trust_tier FROM graph_nodes WHERE id = ? AND kind = 'Preference'")
			.get(input.existingNodeId) as { trust_tier: number } | undefined;

		if (!existing) {
			return {
				blocked: true,
				blockReason: `Preference node ${input.existingNodeId} not found`,
			};
		}

		if (existing.trust_tier === 1) {
			return {
				blocked: false,
				confirmationRequired: true,
				supersededNodeId: input.existingNodeId,
			};
		}

		raw.prepare(
			"UPDATE graph_nodes SET t_valid_until = ?, t_expired = ? WHERE id = ?",
		).run(now, now, input.existingNodeId);

		return { blocked: false, supersededNodeId: input.existingNodeId };
	}

	// Unreachable — but keep a defensive default.
	// nowSec is captured to defeat potential dead-code lints when future
	// actions are added that want the second-resolution timestamp.
	void nowSec;
	return {
		blocked: true,
		blockReason: `Unknown action: ${String((input as { action: string }).action)}`,
	};
}
