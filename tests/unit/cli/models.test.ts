import { describe, expect, it } from "vitest";
import { formatModelStatus } from "@/cli/commands/models";

describe("sia models CLI", () => {
	it("formatModelStatus returns human-readable status", () => {
		const output = formatModelStatus({
			installedTier: "T0",
			models: {
				"bge-small-en-v1.5": {
					version: "1.0",
					variant: "int8",
					sha256: "abc123",
					sizeBytes: 33_000_000,
					source: "huggingface",
					installedAt: "2026-03-26T00:00:00Z",
					tier: "T0",
				},
			},
			attentionHead: {
				trainingPhase: "rrf",
				feedbackEvents: 0,
				lastTrained: null,
				projectVariants: {},
			},
			schemaVersion: 1,
		});

		expect(output).toContain("T0");
		expect(output).toContain("bge-small");
		expect(output).toContain("33.0 MB");
	});
});
