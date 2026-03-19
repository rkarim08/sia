import { describe, expect, it } from "vitest";
import { detectCommitPatterns, detectKnowledgePatterns } from "@/hooks/extractors/pattern-detector";

describe("detectKnowledgePatterns", () => {
	it("detects Decision patterns with 'we decided'", () => {
		const content = "We decided to use SQLite instead of Postgres for local storage.";
		const patterns = detectKnowledgePatterns(content);
		expect(patterns.length).toBeGreaterThanOrEqual(1);
		expect(patterns.some((p) => p.type === "Decision")).toBe(true);
	});

	it("detects Decision patterns with 'chose X over'", () => {
		const content = "The team chose Bun over Node for runtime performance.";
		const patterns = detectKnowledgePatterns(content);
		expect(patterns.some((p) => p.type === "Decision")).toBe(true);
	});

	it("detects Convention patterns with 'convention:' prefix", () => {
		const content = "Convention: always use camelCase for local variables.";
		const patterns = detectKnowledgePatterns(content);
		expect(patterns.some((p) => p.type === "Convention")).toBe(true);
		const convention = patterns.find((p) => p.type === "Convention");
		expect(convention?.content).toContain("camelCase");
	});

	it("detects Convention patterns with 'always use'", () => {
		const content = "We should always use strict TypeScript mode in this project.";
		const patterns = detectKnowledgePatterns(content);
		expect(patterns.some((p) => p.type === "Convention")).toBe(true);
	});

	it("detects Bug patterns with 'BUG:' prefix", () => {
		const content = "BUG: The connection pool leaks when timeout exceeds 30s.";
		const patterns = detectKnowledgePatterns(content);
		expect(patterns.some((p) => p.type === "Bug")).toBe(true);
	});

	it("detects Bug patterns with 'FIXME:' prefix", () => {
		const content = "FIXME: race condition in the event loop causes deadlock.";
		const patterns = detectKnowledgePatterns(content);
		expect(patterns.some((p) => p.type === "Bug")).toBe(true);
	});

	it("detects Bug patterns with 'HACK:' prefix", () => {
		const content = "HACK: workaround for upstream parser bug in v2.3.";
		const patterns = detectKnowledgePatterns(content);
		expect(patterns.some((p) => p.type === "Bug")).toBe(true);
	});

	it("detects Concept patterns with 'TODO:' prefix", () => {
		const content = "TODO: implement retry logic with exponential backoff.";
		const patterns = detectKnowledgePatterns(content);
		expect(patterns.some((p) => p.type === "Concept")).toBe(true);
	});

	it("detects Concept patterns with 'REFACTOR:' prefix", () => {
		const content = "REFACTOR: extract the validation logic into a shared module.";
		const patterns = detectKnowledgePatterns(content);
		expect(patterns.some((p) => p.type === "Concept")).toBe(true);
	});

	it("returns empty array for content with no patterns", () => {
		const content = "This is just regular text with no special markers.";
		const patterns = detectKnowledgePatterns(content);
		expect(patterns).toEqual([]);
	});

	it("detects multiple patterns in one block of content", () => {
		const content = [
			"We decided to use Vitest for testing.",
			"Convention: always mock external APIs.",
			"BUG: flaky test in CI due to timing.",
		].join("\n");
		const patterns = detectKnowledgePatterns(content);
		expect(patterns.length).toBeGreaterThanOrEqual(3);
		const types = patterns.map((p) => p.type);
		expect(types).toContain("Decision");
		expect(types).toContain("Convention");
		expect(types).toContain("Bug");
	});

	it("each detected pattern has required fields", () => {
		const content = "We decided to adopt a monorepo structure.";
		const patterns = detectKnowledgePatterns(content);
		for (const p of patterns) {
			expect(p.type).toBeDefined();
			expect(p.content).toBeDefined();
			expect(typeof p.confidence).toBe("number");
			expect(p.confidence).toBeGreaterThan(0);
			expect(p.confidence).toBeLessThanOrEqual(1);
		}
	});
});

describe("detectCommitPatterns", () => {
	it("detects Solution from 'fix' prefix commit", () => {
		const message = "fix(auth): resolve token refresh race condition";
		const patterns = detectCommitPatterns(message);
		expect(patterns.some((p) => p.type === "Solution")).toBe(true);
	});

	it("detects Decision from 'feat' prefix commit", () => {
		const message = "feat(hooks): add PostToolUse handler for Write operations";
		const patterns = detectCommitPatterns(message);
		expect(patterns.some((p) => p.type === "Decision")).toBe(true);
	});

	it("detects Decision from 'refactor' prefix commit", () => {
		const message = "refactor(graph): migrate from raw SQL to SiaDb interface";
		const patterns = detectCommitPatterns(message);
		expect(patterns.some((p) => p.type === "Decision")).toBe(true);
	});

	it("returns empty array for non-conventional commit", () => {
		const message = "update readme";
		const patterns = detectCommitPatterns(message);
		expect(patterns).toEqual([]);
	});

	it("commit pattern includes the full message as content", () => {
		const message = "fix(db): handle null timestamps in migration";
		const patterns = detectCommitPatterns(message);
		const solution = patterns.find((p) => p.type === "Solution");
		expect(solution?.content).toBe(message);
	});
});
