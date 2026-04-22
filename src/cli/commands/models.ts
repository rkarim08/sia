// Module: cli/commands/models — sia models status/upgrade/downgrade

import { getModelsToDownload, getModelsToRemove } from "@/models/registry";
import type { ModelManifest, ModelTier } from "@/models/types";
import { TIER_ORDER } from "@/models/types";

/**
 * Format model manifest into human-readable status output.
 */
export function formatModelStatus(manifest: ModelManifest): string {
	const lines: string[] = [];
	lines.push(`Installed tier: ${manifest.installedTier}`);
	lines.push(
		`Attention head: ${manifest.attentionHead.trainingPhase} (${manifest.attentionHead.feedbackEvents} events)`,
	);
	lines.push("");
	lines.push("Models:");

	for (const [name, entry] of Object.entries(manifest.models)) {
		const sizeMb = (entry.sizeBytes / 1_000_000).toFixed(1);
		lines.push(`  ${name} (${entry.variant}, ${sizeMb} MB) — installed ${entry.installedAt}`);
	}

	const totalBytes = Object.values(manifest.models).reduce((sum, e) => sum + e.sizeBytes, 0);
	lines.push("");
	lines.push(`Total disk: ${(totalBytes / 1_000_000).toFixed(1)} MB`);

	return lines.join("\n");
}

/**
 * Handle `sia models` subcommands: status, upgrade, downgrade.
 */
export async function handleModelsCommand(
	action: "status" | "upgrade" | "downgrade",
	targetTier: ModelTier | undefined,
	modelManager: {
		getManifest(): ModelManifest;
		installModel?(name: string): Promise<void>;
		removeModel(name: string): void;
		setInstalledTier(tier: ModelTier): void;
	},
): Promise<string> {
	const manifest = modelManager.getManifest();

	if (action === "status") {
		return formatModelStatus(manifest);
	}

	if (!targetTier) {
		return "Error: target tier required for upgrade/downgrade (T0, T1, T2, T3)";
	}

	if (action === "upgrade") {
		if (TIER_ORDER[targetTier] <= TIER_ORDER[manifest.installedTier]) {
			return `Already at ${manifest.installedTier}, cannot upgrade to ${targetTier}`;
		}
		const toDownload = getModelsToDownload(manifest.installedTier, targetTier);
		for (const name of Object.keys(toDownload)) {
			if (modelManager.installModel) {
				await modelManager.installModel(name);
			}
		}
		modelManager.setInstalledTier(targetTier);
		return `Upgraded to ${targetTier}. Downloaded ${Object.keys(toDownload).length} model(s).`;
	}

	if (action === "downgrade") {
		if (TIER_ORDER[targetTier] >= TIER_ORDER[manifest.installedTier]) {
			return `Already at ${manifest.installedTier}, cannot downgrade to ${targetTier}`;
		}
		const toRemove = getModelsToRemove(manifest.installedTier, targetTier);
		for (const name of toRemove) {
			modelManager.removeModel(name);
		}
		modelManager.setInstalledTier(targetTier);
		return `Downgraded to ${targetTier}. Removed ${toRemove.length} model(s).`;
	}

	return "Unknown action";
}
