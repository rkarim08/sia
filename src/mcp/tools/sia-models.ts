// Module: sia-models — MCP tool for model tier status inspection

import { z } from "zod";
import { buildNextSteps, type NextStep } from "@/mcp/next-steps";
import type { ModelManager } from "@/models/manager";

export const SiaModelsInput = z.object({
	action: z.enum(["status"]).describe("Action to perform. Currently only 'status' is supported."),
});

export type SiaModelsInputType = z.infer<typeof SiaModelsInput>;

/**
 * Structured response for `sia_models`.
 *
 * Historically the handler returned a bare string. With Phase A2 we return
 * a small envelope so the MCP response can carry both the formatted text
 * and a `next_steps` array. Existing behaviour is preserved via the `text`
 * field — consumers that previously read the string should read `text`.
 */
export interface SiaModelsResult {
	text: string;
	next_steps?: NextStep[];
}

/**
 * Handle the sia_models MCP tool.
 *
 * Returns a human-readable summary of the installed model tier, individual
 * model entries, attention head training phase, and total disk usage, plus
 * a `next_steps` hint array.
 */
export function handleSiaModels(
	input: SiaModelsInputType,
	modelManager: ModelManager | null,
): SiaModelsResult {
	if (!modelManager) {
		return { text: "Model manager not available. Run `sia setup` to initialize." };
	}

	let text: string;
	if (input.action === "status") {
		const manifest = modelManager.getManifest();

		const modelLines = Object.entries(manifest.models)
			.map(
				([name, entry]) =>
					`  ${entry.tier} ${name} (${entry.variant}, ${(entry.sizeBytes / 1_048_576).toFixed(0)} MB)`,
			)
			.join("\n");

		const totalSize = Object.values(manifest.models).reduce((sum, e) => sum + e.sizeBytes, 0);

		text = [
			`Installed tier: ${manifest.installedTier}`,
			`Models:`,
			modelLines || "  (none installed)",
			``,
			`Attention head: ${manifest.attentionHead.trainingPhase} (${manifest.attentionHead.feedbackEvents} feedback events)`,
			`Total disk usage: ${(totalSize / 1_048_576).toFixed(0)} MB`,
		].join("\n");
	} else {
		text = `Unknown action: ${input.action}`;
	}

	const nextSteps = buildNextSteps("sia_models", {});
	return nextSteps.length > 0 ? { text, next_steps: nextSteps } : { text };
}
