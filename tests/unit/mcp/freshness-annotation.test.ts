import { describe, expect, it } from "vitest";
import { annotateFreshness } from "@/mcp/freshness-annotator";

describe("freshness annotation", () => {
	it("should annotate entities with freshness state", async () => {
		const entities = [
			{ id: "1", name: "test", file_paths: '["src/test.ts"]', trust_tier: 2 },
			{ id: "2", name: "test2", file_paths: '["src/test2.ts"]', trust_tier: 3 },
		];

		// Without a real db, freshness defaults to "unknown"
		const annotated = await annotateFreshness(entities, null);
		expect(annotated).toHaveLength(2);
		expect(annotated[0]).toHaveProperty("freshness");
	});

	it("should pass through entities with no file_paths", async () => {
		const entities = [
			{ id: "1", name: "concept", file_paths: null, trust_tier: 1 },
		];
		const annotated = await annotateFreshness(entities, null);
		expect(annotated[0].freshness).toBe("unknown");
	});
});
