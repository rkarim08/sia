// Module: prisma-schema — Regex-based Prisma model extraction

import type { CandidateFact } from "@/capture/types";

/**
 * Extract model entities from Prisma schema files using regex patterns.
 * Recognises `model <Name> { ... }` blocks.
 */
export function extractPrismaSchema(content: string, filePath: string): CandidateFact[] {
	const facts: CandidateFact[] = [];

	const modelRe = /model\s+(\w+)\s*\{([^}]*)}/g;
	let match: RegExpExecArray | null = modelRe.exec(content);
	while (match !== null) {
		const name = match[1];
		const body = match[2].trim();

		// Build a summary from the field lines
		const fields = body
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"));

		const summary = fields.length > 0
			? `Prisma model ${name}: ${fields.slice(0, 5).join(", ")}${fields.length > 5 ? "..." : ""}`
			: `Prisma model: ${name}`;

		facts.push({
			type: "CodeEntity",
			name,
			content: match[0],
			summary,
			tags: ["model"],
			file_paths: [filePath],
			trust_tier: 2,
			confidence: 0.9,
			extraction_method: "prisma-schema",
		});
		match = modelRe.exec(content);
	}

	return facts;
}
