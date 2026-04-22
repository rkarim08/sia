import { describe, expect, it } from "vitest";
import {
	classifyQueryContent,
	type QueryContentType,
	selectEmbedders,
} from "@/retrieval/query-router";

describe("query router", () => {
	it("detects code-like queries with file paths", () => {
		expect(classifyQueryContent("src/capture/embedder.ts")).toBe("code");
	});

	it("detects code-like queries with camelCase", () => {
		expect(classifyQueryContent("createEmbedder function")).toBe("code");
	});

	it("detects code-like queries with dots and parens", () => {
		expect(classifyQueryContent("session.run(feeds)")).toBe("code");
	});

	it("detects code-like queries with import statements", () => {
		expect(classifyQueryContent('import { Embedder } from "@/capture"')).toBe("code");
	});

	it("classifies natural language queries as NL", () => {
		expect(classifyQueryContent("why did we choose PostgreSQL")).toBe("nl");
	});

	it("classifies simple English questions as NL", () => {
		expect(classifyQueryContent("what is the authentication strategy")).toBe("nl");
	});

	it("classifies mixed queries as mixed", () => {
		expect(classifyQueryContent("what does embedder.ts do")).toBe("mixed");
	});

	it("detects file extensions as code", () => {
		expect(classifyQueryContent("changes to .tsx files")).toBe("code");
	});

	it("detects snake_case identifiers as code", () => {
		expect(classifyQueryContent("trust_tier field usage")).toBe("mixed");
	});

	describe("selectEmbedders", () => {
		it("bug-fix task type forces both embedders", () => {
			const result = selectEmbedders("some simple query", "bug-fix");
			expect(result.useNlEmbedder).toBe(true);
			expect(result.useCodeEmbedder).toBe(true);
		});

		it("regression task type forces both embedders", () => {
			const result = selectEmbedders("why is it slow", "regression");
			expect(result.useNlEmbedder).toBe(true);
			expect(result.useCodeEmbedder).toBe(true);
		});

		it("pure code query uses only code embedder", () => {
			const result = selectEmbedders("myFunction(arg1, arg2)");
			expect(result.useNlEmbedder).toBe(false);
			expect(result.useCodeEmbedder).toBe(true);
		});

		it("pure NL query uses only NL embedder", () => {
			const result = selectEmbedders("why does the system crash on startup?");
			expect(result.useNlEmbedder).toBe(true);
			expect(result.useCodeEmbedder).toBe(false);
		});

		it("mixed query uses both embedders", () => {
			const result = selectEmbedders("how does AuthService.authenticate() work?");
			expect(result.useNlEmbedder).toBe(true);
			expect(result.useCodeEmbedder).toBe(true);
		});
	});
});
