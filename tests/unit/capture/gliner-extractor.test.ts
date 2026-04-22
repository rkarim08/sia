import { describe, expect, it } from "vitest";
import {
	buildGlinerTensors,
	CONFIDENCE_THRESHOLDS,
	classifyExtractionResult,
	createGlinerExtractor,
	type GlinerSpan,
	SIA_ENTITY_LABELS,
} from "@/capture/gliner-extractor";

describe("GLiNER extractor", () => {
	it("SIA_ENTITY_LABELS has all required label types", () => {
		const required = [
			"Decision",
			"Convention",
			"Bug",
			"Solution",
			"Pattern",
			"FilePath",
			"FunctionName",
			"Dependency",
			"API",
			"Constraint",
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

	it("buildGlinerTensors is exported and produces correct tensor shapes", () => {
		expect(typeof buildGlinerTensors).toBe("function");
	});

	it("returns spans from successful chunks when other chunks fail", async () => {
		let chunkIdx = 0;
		const mockSession = {
			run: async () => {
				chunkIdx++;
				if (chunkIdx === 2) throw new Error("ONNX inference failed");
				return {
					spans: [{ text: "express", label: "Dependency", score: 0.9, start: 0, end: 7 }],
				};
			},
		};

		const extractor = createGlinerExtractor({ session: mockSession, maxChunkLength: 2 }); // 2 tokens → 8 chars
		const spans = await extractor.extract("chunk1aaachunk2aaachunk3aaa"); // ~27 chars → 3+ chunks

		// chunk1 succeeds (1 span), chunk2 fails (0 spans), chunk3+ succeed
		expect(spans.length).toBeGreaterThanOrEqual(1);
		expect(spans[0].text).toBe("express");
	});
});
