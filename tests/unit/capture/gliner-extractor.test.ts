import { describe, expect, it } from "vitest";
import {
	SIA_ENTITY_LABELS,
	CONFIDENCE_THRESHOLDS,
	classifyExtractionResult,
	createGlinerExtractor,
	type GlinerSpan,
} from "@/capture/gliner-extractor";

describe("GLiNER extractor", () => {
	it("SIA_ENTITY_LABELS has all required label types", () => {
		const required = [
			"Decision", "Convention", "Bug", "Solution", "Pattern",
			"FilePath", "FunctionName", "Dependency", "API", "Constraint",
		];
		for (const label of required) {
			expect(SIA_ENTITY_LABELS).toContain(label);
		}
	});

	it("CONFIDENCE_THRESHOLDS has entry for every label", () => {
		for (const label of SIA_ENTITY_LABELS) {
			expect(CONFIDENCE_THRESHOLDS).toHaveProperty(label);
			expect(typeof CONFIDENCE_THRESHOLDS[label]).toBe("number");
		}
	});

	it("classifyExtractionResult returns 'accept' for high confidence", () => {
		const span: GlinerSpan = {
			text: "PostgreSQL",
			label: "Dependency",
			score: 0.9,
			start: 0,
			end: 10,
		};
		expect(classifyExtractionResult(span)).toBe("accept");
	});

	it("classifyExtractionResult returns 'confirm' for mid confidence", () => {
		const span: GlinerSpan = {
			text: "use snake_case for APIs",
			label: "Convention",
			score: 0.5,
			start: 0,
			end: 23,
		};
		expect(classifyExtractionResult(span)).toBe("confirm");
	});

	it("classifyExtractionResult returns 'reject' for low confidence", () => {
		const span: GlinerSpan = {
			text: "maybe",
			label: "Decision",
			score: 0.2,
			start: 0,
			end: 5,
		};
		expect(classifyExtractionResult(span)).toBe("reject");
	});

	it("extractor returns empty when session is null (graceful degradation)", async () => {
		const extractor = createGlinerExtractor({ session: null, maxChunkLength: 512 });
		const spans = await extractor.extract("some text about PostgreSQL decisions");
		expect(spans).toHaveLength(0);
	});

	it("extractor chunks long text into multiple segments", async () => {
		const chunks: string[] = [];
		const mockSession = {
			run: async (feeds: Record<string, unknown>) => {
				chunks.push((feeds.text as { data: string }).data);
				return { spans: [] };
			},
		};

		const extractor = createGlinerExtractor({ session: mockSession, maxChunkLength: 2 }); // 2 tokens → 8 chars
		await extractor.extract("abcdefghijklmnop"); // 16 chars → 2 chunks

		expect(chunks.length).toBe(2);
	});
});
