// Module: sia-doctor — Handler for the sia_doctor diagnostic tool

import type { z } from "zod";
import type { SiaDb } from "@/graph/db-interface";
import { buildNextSteps, type NextStep } from "@/mcp/next-steps";
import type { SiaDoctorInput } from "@/mcp/server";
import { RUNTIME_MAP } from "@/sandbox/executor";
import {
	checkFts5,
	checkOrphanEdges,
	checkRuntime,
	checkTemporalInvariants,
	type DiagnosticCheck,
} from "@/shared/diagnostics";

// ---------------------------------------------------------------------------
// SiaDoctorResult
// ---------------------------------------------------------------------------

export interface SiaDoctorResult {
	checks: DiagnosticCheck[];
	healthy: boolean;
	warnings: string[];
	next_steps?: NextStep[];
}

// ---------------------------------------------------------------------------
// handleSiaDoctor
// ---------------------------------------------------------------------------

export async function handleSiaDoctor(
	db: SiaDb,
	input: z.infer<typeof SiaDoctorInput>,
): Promise<SiaDoctorResult> {
	const requested = input.checks ?? ["all"];
	const runAll = requested.includes("all");

	const checks: DiagnosticCheck[] = [];

	// -----------------------------------------------------------------------
	// Runtimes (14 entries from RUNTIME_MAP)
	// -----------------------------------------------------------------------
	if (runAll || requested.includes("runtimes")) {
		const runtimeChecks = await Promise.all(
			Object.entries(RUNTIME_MAP).map(([lang, def]) => checkRuntime(lang, def.cmd)),
		);
		checks.push(...runtimeChecks);
	}

	// -----------------------------------------------------------------------
	// FTS5
	// -----------------------------------------------------------------------
	if (runAll || requested.includes("fts5")) {
		checks.push(await checkFts5(db));
	}

	// -----------------------------------------------------------------------
	// Graph integrity: orphan edges + temporal invariants
	// -----------------------------------------------------------------------
	if (runAll || requested.includes("graph_integrity")) {
		const [orphanResult, temporalResult] = await Promise.all([
			checkOrphanEdges(db),
			checkTemporalInvariants(db),
		]);
		checks.push(orphanResult, temporalResult);
	}

	// -----------------------------------------------------------------------
	// Aggregate
	// -----------------------------------------------------------------------
	const healthy = checks.every((c) => c.status === "ok");
	const warnings = checks.filter((c) => c.status !== "ok").map((c) => c.message);

	const nextSteps = buildNextSteps("sia_doctor", { hasFailure: !healthy });
	const response: SiaDoctorResult = { checks, healthy, warnings };
	if (nextSteps.length > 0) response.next_steps = nextSteps;
	return response;
}
