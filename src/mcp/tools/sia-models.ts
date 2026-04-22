// Module: sia-models — MCP tool for model tier status inspection

import { z } from "zod";
import type { ModelManager } from "@/models/manager";

export const SiaModelsInput = z.object({
	action: z.enum(["status"]).describe("Action to perform. Currently only 'status' is supported."),
});

export type SiaModelsInputType = z.infer<typeof SiaModelsInput>;

/**
 * Handle the sia_models MCP tool.
 *
 * Returns a human-readable summary of the installed model tier, individual
 * model entries, attention head training phase, and total disk usage.
 */
export function handleSiaModels(
	input: SiaModelsInputType,
	modelManager: ModelManager | null,
): string {
	if (!modelManager) {
		return "Model manager not available. Run `sia setup` to initialize.";
	}

	if (input.action === "status") {
		const manifest = modelManager.getManifest();

		const modelLines = Object.entries(manifest.models)
			.map(
				([name, entry]) =>
					`  ${entry.tier} ${name} (${entry.variant}, ${(entry.sizeBytes / 1_048_576).toFixed(0)} MB)`,
			)
			.join("\n");

		const totalSize = Object.values(manifest.models).reduce((sum, e) => sum + e.sizeBytes, 0);

		return [
			`Installed tier: ${manifest.installedTier}`,
			`Models:`,
			modelLines || "  (none installed)",
			``,
			`Attention head: ${manifest.attentionHead.trainingPhase} (${manifest.attentionHead.feedbackEvents} feedback events)`,
			`Total disk usage: ${(totalSize / 1_048_576).toFixed(0)} MB`,
		].join("\n");
	}

	return `Unknown action: ${input.action}`;
}
