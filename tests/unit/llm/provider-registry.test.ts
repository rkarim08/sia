import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "@/llm/provider-registry";
import { ProviderRegistry } from "@/llm/provider-registry";

describe("ProviderRegistry", () => {
	it("default capture mode is hooks", () => {
		const registry = new ProviderRegistry();
		expect(registry.getCaptureMode()).toBe("hooks");
	});

	it("set and get capture mode", () => {
		const registry = new ProviderRegistry();
		registry.setCaptureMode("api");
		expect(registry.getCaptureMode()).toBe("api");
		registry.setCaptureMode("hybrid");
		expect(registry.getCaptureMode()).toBe("hybrid");
	});

	it("set and get provider config", () => {
		const registry = new ProviderRegistry();
		const config: ProviderConfig = { provider: "anthropic", model: "claude-sonnet-4" };
		registry.setProvider("summarize", config);

		const retrieved = registry.getProvider("summarize");
		expect(retrieved).toEqual(config);
	});

	it("getProvider returns undefined for unset role", () => {
		const registry = new ProviderRegistry();
		expect(registry.getProvider("extract")).toBeUndefined();
	});

	it("setProvider overwrites existing config", () => {
		const registry = new ProviderRegistry();
		registry.setProvider("validate", { provider: "anthropic", model: "claude-haiku-4-5" });
		registry.setProvider("validate", { provider: "ollama", model: "qwen2.5-coder:7b" });

		const retrieved = registry.getProvider("validate");
		expect(retrieved?.provider).toBe("ollama");
		expect(retrieved?.model).toBe("qwen2.5-coder:7b");
	});

	describe("isRoleActive", () => {
		it("hooks mode: extract is inactive", () => {
			const registry = new ProviderRegistry();
			registry.setCaptureMode("hooks");
			expect(registry.isRoleActive("extract")).toBe(false);
		});

		it("hooks mode: consolidate is inactive", () => {
			const registry = new ProviderRegistry();
			registry.setCaptureMode("hooks");
			expect(registry.isRoleActive("consolidate")).toBe(false);
		});

		it("hooks mode: summarize is active", () => {
			const registry = new ProviderRegistry();
			registry.setCaptureMode("hooks");
			expect(registry.isRoleActive("summarize")).toBe(true);
		});

		it("hooks mode: validate is active", () => {
			const registry = new ProviderRegistry();
			registry.setCaptureMode("hooks");
			expect(registry.isRoleActive("validate")).toBe(true);
		});

		it("api mode: all roles active", () => {
			const registry = new ProviderRegistry();
			registry.setCaptureMode("api");
			expect(registry.isRoleActive("extract")).toBe(true);
			expect(registry.isRoleActive("consolidate")).toBe(true);
			expect(registry.isRoleActive("summarize")).toBe(true);
			expect(registry.isRoleActive("validate")).toBe(true);
		});

		it("hybrid mode: all roles active", () => {
			const registry = new ProviderRegistry();
			registry.setCaptureMode("hybrid");
			expect(registry.isRoleActive("extract")).toBe(true);
			expect(registry.isRoleActive("consolidate")).toBe(true);
			expect(registry.isRoleActive("summarize")).toBe(true);
			expect(registry.isRoleActive("validate")).toBe(true);
		});
	});

	it("getAll returns all configured providers", () => {
		const registry = new ProviderRegistry();
		registry.setProvider("summarize", { provider: "anthropic", model: "claude-sonnet-4" });
		registry.setProvider("validate", { provider: "ollama", model: "qwen2.5-coder:7b" });

		const all = registry.getAll();
		expect(all.size).toBe(2);
		expect(all.get("summarize")?.provider).toBe("anthropic");
		expect(all.get("validate")?.provider).toBe("ollama");
	});

	it("getAll returns empty map when nothing configured", () => {
		const registry = new ProviderRegistry();
		const all = registry.getAll();
		expect(all.size).toBe(0);
	});
});
