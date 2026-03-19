import { describe, expect, it } from "vitest";
import { CostTracker } from "@/llm/cost-tracker";

describe("CostTracker", () => {
	it("starts with zero spend", () => {
		const tracker = new CostTracker();
		expect(tracker.getTodaySpend()).toBe(0);
		expect(tracker.getEntries().length).toBe(0);
	});

	it("logs calls and tracks daily spend", () => {
		const tracker = new CostTracker(10);
		tracker.logCall({
			provider: "anthropic",
			model: "claude-sonnet-4",
			role: "summarize",
			input_tokens: 1000,
			output_tokens: 500,
			estimated_cost: 0.05,
		});

		expect(tracker.getTodaySpend()).toBeCloseTo(0.05);
		expect(tracker.getEntries()).toHaveLength(1);
	});

	it("accumulates multiple calls", () => {
		const tracker = new CostTracker(10);
		tracker.logCall({
			provider: "anthropic",
			model: "claude-sonnet-4",
			role: "summarize",
			input_tokens: 1000,
			output_tokens: 500,
			estimated_cost: 0.05,
		});
		tracker.logCall({
			provider: "anthropic",
			model: "claude-haiku-4-5",
			role: "validate",
			input_tokens: 500,
			output_tokens: 200,
			estimated_cost: 0.01,
		});

		expect(tracker.getTodaySpend()).toBeCloseTo(0.06);
		expect(tracker.getEntries()).toHaveLength(2);
	});

	it("budget exceeded detection", () => {
		const tracker = new CostTracker(0.1);
		expect(tracker.isBudgetExceeded()).toBe(false);

		tracker.logCall({
			provider: "anthropic",
			model: "claude-sonnet-4",
			role: "summarize",
			input_tokens: 10000,
			output_tokens: 5000,
			estimated_cost: 0.08,
		});
		expect(tracker.isBudgetExceeded()).toBe(false);

		tracker.logCall({
			provider: "anthropic",
			model: "claude-sonnet-4",
			role: "summarize",
			input_tokens: 10000,
			output_tokens: 5000,
			estimated_cost: 0.05,
		});
		expect(tracker.isBudgetExceeded()).toBe(true);
	});

	it("no budget configured means never exceeded", () => {
		const tracker = new CostTracker();
		tracker.logCall({
			provider: "anthropic",
			model: "claude-sonnet-4",
			role: "summarize",
			input_tokens: 100000,
			output_tokens: 50000,
			estimated_cost: 999.99,
		});
		expect(tracker.isBudgetExceeded()).toBe(false);
	});

	it("getEntries filters by since timestamp", () => {
		const tracker = new CostTracker();
		const now = Date.now();

		tracker.logCall({
			provider: "anthropic",
			model: "claude-sonnet-4",
			role: "summarize",
			input_tokens: 100,
			output_tokens: 50,
			estimated_cost: 0.01,
		});

		// All entries should be after (now - 1000)
		const recent = tracker.getEntries(now - 1000);
		expect(recent.length).toBe(1);

		// No entries in the future
		const future = tracker.getEntries(now + 60000);
		expect(future.length).toBe(0);
	});

	it("entries have timestamps", () => {
		const tracker = new CostTracker();
		const before = Date.now();
		tracker.logCall({
			provider: "ollama",
			model: "qwen2.5-coder:7b",
			role: "validate",
			input_tokens: 200,
			output_tokens: 100,
			estimated_cost: 0,
		});
		const after = Date.now();

		const entries = tracker.getEntries();
		expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
		expect(entries[0].timestamp).toBeLessThanOrEqual(after);
		expect(entries[0].provider).toBe("ollama");
		expect(entries[0].role).toBe("validate");
	});

	describe("estimateCost", () => {
		it("returns reasonable value for anthropic claude-sonnet-4", () => {
			const cost = CostTracker.estimateCost("anthropic", "claude-sonnet-4", 1000, 500);
			expect(cost).toBeGreaterThan(0);
			expect(cost).toBeLessThan(1);
		});

		it("returns reasonable value for anthropic claude-haiku-4-5", () => {
			const cost = CostTracker.estimateCost("anthropic", "claude-haiku-4-5", 1000, 500);
			expect(cost).toBeGreaterThan(0);
			// Haiku should be cheaper than Sonnet
			const sonnetCost = CostTracker.estimateCost("anthropic", "claude-sonnet-4", 1000, 500);
			expect(cost).toBeLessThan(sonnetCost);
		});

		it("returns 0 for local models", () => {
			const cost = CostTracker.estimateCost("ollama", "qwen2.5-coder:7b", 10000, 5000);
			expect(cost).toBe(0);
		});

		it("returns fallback estimate for unknown provider", () => {
			const cost = CostTracker.estimateCost("unknown", "some-model", 1000, 500);
			expect(cost).toBeGreaterThanOrEqual(0);
		});
	});
});
