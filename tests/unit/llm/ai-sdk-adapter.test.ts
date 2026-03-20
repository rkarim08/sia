import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiSdkAdapter, createAdapter } from "@/llm/ai-sdk-adapter";
import type { ProviderConfig } from "@/llm/provider-registry";
import { ProviderRegistry } from "@/llm/provider-registry";

// Mock the `ai` module so tests don't make real LLM calls
vi.mock("ai", () => ({
	generateText: vi.fn().mockResolvedValue({ text: "mocked response" }),
}));

// Mock provider SDK modules
vi.mock("@ai-sdk/anthropic", () => ({
	anthropic: vi.fn().mockReturnValue({ modelId: "claude-sonnet-4", provider: "anthropic.chat" }),
}));

vi.mock("@ai-sdk/openai", () => ({
	openai: vi.fn().mockReturnValue({ modelId: "gpt-4o", provider: "openai.chat" }),
}));

describe("createAdapter", () => {
	it("returns AiSdkAdapter for anthropic provider", () => {
		const config: ProviderConfig = { provider: "anthropic", model: "claude-sonnet-4" };
		const adapter = createAdapter(config);
		expect(adapter).toBeInstanceOf(AiSdkAdapter);
	});

	it("returns AiSdkAdapter for openai provider", () => {
		const config: ProviderConfig = { provider: "openai", model: "gpt-4o" };
		const adapter = createAdapter(config);
		expect(adapter).toBeInstanceOf(AiSdkAdapter);
	});

	it("returns null for unsupported provider (ollama)", () => {
		const config: ProviderConfig = { provider: "ollama", model: "qwen2.5-coder:7b" };
		const adapter = createAdapter(config);
		expect(adapter).toBeNull();
	});

	it("returns null for unsupported provider (google)", () => {
		const config: ProviderConfig = { provider: "google", model: "gemini-pro" };
		const adapter = createAdapter(config);
		expect(adapter).toBeNull();
	});
});

describe("AiSdkAdapter.generate", () => {
	it("calls generateText with resolved model and returns text", async () => {
		const { generateText } = await import("ai");
		const config: ProviderConfig = { provider: "anthropic", model: "claude-sonnet-4" };
		const adapter = new AiSdkAdapter(config);

		const result = await adapter.generate("summarize this");

		expect(generateText).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: "summarize this" }),
		);
		expect(result).toBe("mocked response");
	});

	it("uses anthropic SDK when provider is anthropic", async () => {
		const { anthropic } = await import("@ai-sdk/anthropic");
		const config: ProviderConfig = { provider: "anthropic", model: "claude-sonnet-4" };
		const adapter = new AiSdkAdapter(config);

		await adapter.generate("test prompt");

		expect(anthropic).toHaveBeenCalledWith("claude-sonnet-4");
	});

	it("uses openai SDK when provider is openai", async () => {
		const { openai } = await import("@ai-sdk/openai");
		const config: ProviderConfig = { provider: "openai", model: "gpt-4o" };
		const adapter = new AiSdkAdapter(config);

		await adapter.generate("test prompt");

		expect(openai).toHaveBeenCalledWith("gpt-4o");
	});

	it("throws for unsupported provider", async () => {
		const config: ProviderConfig = { provider: "google", model: "gemini-pro" };
		const adapter = new AiSdkAdapter(config);

		await expect(adapter.generate("test")).rejects.toThrow("Unsupported AI SDK provider: google");
	});
});

describe("ProviderRegistry.adapt", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns adapter when provider is configured for a role", async () => {
		const registry = new ProviderRegistry();
		registry.setProvider("extract", { provider: "anthropic", model: "claude-sonnet-4" });

		const adapter = await registry.adapt("extract");

		expect(adapter).toBeInstanceOf(AiSdkAdapter);
	});

	it("returns null when no provider is configured for a role", async () => {
		const registry = new ProviderRegistry();

		const adapter = await registry.adapt("extract");

		expect(adapter).toBeNull();
	});

	it("returns null when provider is unsupported (ollama)", async () => {
		const registry = new ProviderRegistry();
		registry.setProvider("validate", { provider: "ollama", model: "qwen2.5-coder:7b" });

		const adapter = await registry.adapt("validate");

		expect(adapter).toBeNull();
	});

	it("returns adapter for summarize role with openai provider", async () => {
		const registry = new ProviderRegistry();
		registry.setProvider("summarize", { provider: "openai", model: "gpt-4o" });

		const adapter = await registry.adapt("summarize");

		expect(adapter).toBeInstanceOf(AiSdkAdapter);
	});
});
