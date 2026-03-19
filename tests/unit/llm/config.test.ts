import { describe, expect, it } from "vitest";
import { getDefaultLlmConfig, loadLlmConfig } from "@/llm/config";

describe("getDefaultLlmConfig", () => {
	it("has hooks capture mode", () => {
		const config = getDefaultLlmConfig();
		expect(config.capture.mode).toBe("hooks");
	});

	it("has hookPort 4521", () => {
		const config = getDefaultLlmConfig();
		expect(config.capture.hookPort).toBe(4521);
	});

	it("has all 4 provider roles configured", () => {
		const config = getDefaultLlmConfig();
		expect(config.providers.extract).toBeDefined();
		expect(config.providers.consolidate).toBeDefined();
		expect(config.providers.summarize).toBeDefined();
		expect(config.providers.validate).toBeDefined();
	});

	it("summarize uses anthropic claude-sonnet-4", () => {
		const config = getDefaultLlmConfig();
		expect(config.providers.summarize.provider).toBe("anthropic");
		expect(config.providers.summarize.model).toBe("claude-sonnet-4");
	});

	it("validate uses ollama qwen2.5-coder:7b", () => {
		const config = getDefaultLlmConfig();
		expect(config.providers.validate.provider).toBe("ollama");
		expect(config.providers.validate.model).toBe("qwen2.5-coder:7b");
	});

	it("extract uses anthropic claude-haiku-4-5", () => {
		const config = getDefaultLlmConfig();
		expect(config.providers.extract.provider).toBe("anthropic");
		expect(config.providers.extract.model).toBe("claude-haiku-4-5");
	});

	it("consolidate uses anthropic claude-haiku-4-5", () => {
		const config = getDefaultLlmConfig();
		expect(config.providers.consolidate.provider).toBe("anthropic");
		expect(config.providers.consolidate.model).toBe("claude-haiku-4-5");
	});

	it("fallback chain defaults", () => {
		const config = getDefaultLlmConfig();
		expect(config.fallback.enabled).toBe(true);
		expect(config.fallback.chain).toEqual(["anthropic", "openai", "ollama"]);
		expect(config.fallback.maxRetries).toBe(3);
	});

	it("cost tracking defaults", () => {
		const config = getDefaultLlmConfig();
		expect(config.costTracking.enabled).toBe(true);
		expect(config.costTracking.budgetPerDay).toBeGreaterThan(0);
	});
});

describe("loadLlmConfig", () => {
	it("returns defaults when no config file exists", () => {
		const config = loadLlmConfig("/nonexistent/path/sia.config.yaml");
		const defaults = getDefaultLlmConfig();
		expect(config).toEqual(defaults);
	});

	it("returns defaults when called without path", () => {
		const config = loadLlmConfig();
		const defaults = getDefaultLlmConfig();
		expect(config).toEqual(defaults);
	});
});
