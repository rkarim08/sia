// Module: maintenance-scheduler — central orchestrator for decay/lifecycle work units
//
// Three trigger modes:
// 1. Startup Catchup — if > maintenanceInterval since last sweep, run full sweep
// 2. Idle Opportunistic — on 60s idle gap, run ONE batch from highest-priority unit
// 3. Session-End Sweep — targeted dedup of current session's entities

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archiveBatch } from "@/decay/archiver";
import { bridgeOrphanBatch } from "@/decay/bridge-orphan-cleanup";
import { consolidationSweepBatch } from "@/decay/consolidation-sweep";
import { decayBatch } from "@/decay/decay";
import { deepValidateBatch } from "@/decay/deep-validator";
import { promoteBatch } from "@/decay/episodic-promoter";
import { sweepSession } from "@/decay/session-sweeper";
import type { BatchResult } from "@/decay/types";
import type { SiaDb } from "@/graph/db-interface";
import { SIA_HOME, type SiaConfig } from "@/shared/config";
import type { LlmClient } from "@/shared/llm-client";

// ---------------------------------------------------------------------------
// State file persistence
// ---------------------------------------------------------------------------

interface MaintenanceState {
	lastSweepAt: number;
	lastSessionSweepAt: number;
	pendingBatchOffset: number;
}

const DEFAULT_STATE: MaintenanceState = {
	lastSweepAt: 0,
	lastSessionSweepAt: 0,
	pendingBatchOffset: 0,
};

function stateFilePath(repoHash: string, siaHome?: string): string {
	return join(siaHome ?? SIA_HOME, "repos", repoHash, "maintenance.json");
}

export function loadMaintenanceState(repoHash: string, siaHome?: string): MaintenanceState {
	const path = stateFilePath(repoHash, siaHome);
	if (!existsSync(path)) return { ...DEFAULT_STATE };
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as MaintenanceState;
	} catch {
		return { ...DEFAULT_STATE };
	}
}

export function saveMaintenanceState(
	repoHash: string,
	state: MaintenanceState,
	siaHome?: string,
): void {
	const path = stateFilePath(repoHash, siaHome);
	const dir = join(siaHome ?? SIA_HOME, "repos", repoHash);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Work unit registry
// ---------------------------------------------------------------------------

type WorkUnitFn = (batchSize: number) => Promise<BatchResult>;

interface WorkUnit {
	name: string;
	fn: WorkUnitFn;
}

function buildWorkUnits(
	graphDb: SiaDb,
	episodicDb: SiaDb | null,
	bridgeDb: SiaDb | null,
	config: SiaConfig,
	llmClient: LlmClient | null,
): WorkUnit[] {
	const units: WorkUnit[] = [
		{
			name: "decay",
			fn: (batchSize) => decayBatch(graphDb, config, batchSize, 0),
		},
		{
			name: "archival",
			fn: (batchSize) => archiveBatch(graphDb, config, batchSize),
		},
		{
			name: "consolidation",
			fn: (batchSize) => consolidationSweepBatch(graphDb, batchSize),
		},
	];

	if (episodicDb) {
		units.push({
			name: "episodic-promotion",
			fn: (batchSize) => promoteBatch(graphDb, episodicDb, batchSize),
		});
	}

	if (llmClient) {
		units.push({
			name: "deep-validation",
			fn: (batchSize) => deepValidateBatch(graphDb, llmClient, batchSize),
		});
	}

	if (bridgeDb) {
		units.push({
			name: "bridge-orphan",
			fn: (batchSize) => bridgeOrphanBatch(bridgeDb, batchSize),
		});
	}

	return units;
}

// ---------------------------------------------------------------------------
// Scheduler implementation
// ---------------------------------------------------------------------------

export interface MaintenanceSchedulerOpts {
	graphDb: SiaDb;
	episodicDb?: SiaDb | null;
	bridgeDb?: SiaDb | null;
	config: SiaConfig;
	repoHash: string;
	llmClient?: LlmClient | null;
	siaHome?: string;
}

export interface MaintenanceScheduler {
	onStartup(repoHash: string): Promise<void>;
	onPostToolUse(): void;
	onSessionEnd(sessionId: string): Promise<void>;
	stop(): void;
}

/**
 * Create a maintenance scheduler instance.
 *
 * The scheduler manages three trigger modes:
 * - Startup: full sweep if overdue (> maintenanceInterval)
 * - Idle: one batch per idle cycle (60s gap in PostToolUse events)
 * - Session-end: targeted dedup of session entities
 */
export function createMaintenanceScheduler(opts: MaintenanceSchedulerOpts): MaintenanceScheduler {
	const { graphDb, config, repoHash, siaHome } = opts;
	const episodicDb = opts.episodicDb ?? null;
	const bridgeDb = opts.bridgeDb ?? null;
	const llmClient = opts.llmClient ?? null;

	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;
	let lastDeepValidation = 0;

	const workUnits = buildWorkUnits(graphDb, episodicDb, bridgeDb, config, llmClient);

	// -----------------------------------------------------------------------
	// Startup catchup
	// -----------------------------------------------------------------------

	async function onStartup(): Promise<void> {
		if (stopped) return;

		const state = loadMaintenanceState(repoHash, siaHome);
		const elapsed = Date.now() - state.lastSweepAt;

		if (elapsed < config.maintenanceInterval) return;

		// Run full sweep with large batches (500)
		const STARTUP_BATCH = 500;

		for (const unit of workUnits) {
			if (stopped) break;

			// Rate-limit deep validation
			if (unit.name === "deep-validation") {
				const sinceLast = Date.now() - lastDeepValidation;
				if (sinceLast < config.deepValidationRateMs) continue;
			}

			let hasMore = true;
			while (hasMore && !stopped) {
				if (unit.name === "deep-validation") {
					lastDeepValidation = Date.now();
				}

				const result = await unit.fn(STARTUP_BATCH);
				hasMore = result.remaining;

				// Yield to event loop between batches
				await new Promise((r) => setTimeout(r, 0));
			}
		}

		// FTS5 optimization after full sweep
		try {
			await graphDb.execute("INSERT INTO entities_fts(entities_fts) VALUES('optimize')");
		} catch {
			// FTS5 table may not exist in all configurations
		}

		state.lastSweepAt = Date.now();
		state.pendingBatchOffset = 0;
		saveMaintenanceState(repoHash, state, siaHome);
	}

	// -----------------------------------------------------------------------
	// Idle opportunistic
	// -----------------------------------------------------------------------

	function scheduleIdleCheck(): void {
		if (stopped || idleTimer) return;

		idleTimer = setTimeout(async () => {
			idleTimer = null;
			if (stopped) return;

			// Run ONE batch from the highest-priority unit that has work
			for (const unit of workUnits) {
				if (stopped) break;

				// Rate-limit deep validation
				if (unit.name === "deep-validation") {
					const sinceLast = Date.now() - lastDeepValidation;
					if (sinceLast < config.deepValidationRateMs) continue;
					lastDeepValidation = Date.now();
				}

				const result = await unit.fn(50);
				if (result.processed > 0) break; // Did some work, yield back
			}
		}, config.idleTimeoutMs);
	}

	function onPostToolUse(): void {
		// Reset idle timer on each tool use
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = null;
		}
		scheduleIdleCheck();
	}

	// -----------------------------------------------------------------------
	// Session-end sweep
	// -----------------------------------------------------------------------

	async function onSessionEnd(sessionId: string): Promise<void> {
		if (stopped) return;

		await sweepSession(graphDb, sessionId);

		const state = loadMaintenanceState(repoHash, siaHome);
		state.lastSessionSweepAt = Date.now();
		saveMaintenanceState(repoHash, state, siaHome);
	}

	// -----------------------------------------------------------------------
	// Stop
	// -----------------------------------------------------------------------

	function stop(): void {
		stopped = true;
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = null;
		}
	}

	return {
		onStartup: () => onStartup(),
		onPostToolUse,
		onSessionEnd,
		stop,
	};
}

// ---------------------------------------------------------------------------
// Standalone full sweep (for backward compatibility / CLI usage)
// ---------------------------------------------------------------------------

/**
 * Run all maintenance jobs in sequence.
 *
 * This is the "old" runNightlyJobs interface, preserved for CLI invocation.
 * Errors in one job do not prevent others from running.
 */
export async function runMaintenanceJobs(
	config: SiaConfig,
	graphDb: SiaDb,
	episodicDb?: SiaDb,
	bridgeDb?: SiaDb,
	llmClient?: LlmClient,
): Promise<void> {
	const units = buildWorkUnits(
		graphDb,
		episodicDb ?? null,
		bridgeDb ?? null,
		config,
		llmClient ?? null,
	);

	for (const unit of units) {
		try {
			let hasMore = true;
			while (hasMore) {
				const result = await unit.fn(500);
				hasMore = result.remaining;
			}
			console.log(`[maintenance] ${unit.name}: complete`);
		} catch (err) {
			console.error(`[maintenance] ${unit.name}: failed`, err);
		}
	}

	// FTS5 optimization
	try {
		await graphDb.execute("INSERT INTO entities_fts(entities_fts) VALUES('optimize')");
	} catch {
		// FTS5 may not exist
	}
}
