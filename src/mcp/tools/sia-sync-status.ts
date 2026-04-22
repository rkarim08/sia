// Module: sia-sync-status — MCP tool handler for team sync status.
//
// Returns the current sync configuration and status.
// Read-only — does not require a database connection.

import { buildNextSteps, type NextStep } from "@/mcp/next-steps";
import { getConfig, resolveSiaHome } from "@/shared/config";

export interface SiaSyncStatusResult {
	enabled: boolean;
	status: "not_configured" | "active" | "error";
	server_url?: string;
	developer_id?: string;
	sync_interval_seconds?: number;
	error?: string;
	next_steps?: NextStep[];
}

/**
 * Check the current team sync configuration and status.
 */
export async function handleSiaSyncStatus(): Promise<SiaSyncStatusResult> {
	try {
		const config = getConfig(resolveSiaHome());
		const sync = config.sync;

		if (!sync.enabled || !sync.serverUrl) {
			return { enabled: false, status: "not_configured" };
		}

		return {
			enabled: true,
			status: "active",
			server_url: sync.serverUrl,
			developer_id: sync.developerId ?? undefined,
			sync_interval_seconds: sync.syncInterval,
		};
	} catch (err) {
		console.error("[sia] sia_sync_status error:", err);
		const nextSteps = buildNextSteps("sia_sync_status", { hasFailure: true });
		const response: SiaSyncStatusResult = {
			enabled: false,
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		};
		if (nextSteps.length > 0) response.next_steps = nextSteps;
		return response;
	}
}
