import type { ProviderConfig } from "@/llm/provider-registry";

/**
 * Adapter that resolves a ProviderConfig to an actual AI SDK model
 * and executes text generation.
 *
 * Falls back gracefully if the AI SDK or provider packages aren't available.
 */
export class AiSdkAdapter {
	private config: ProviderConfig;

	constructor(config: ProviderConfig) {
		this.config = config;
	}

	async generate(prompt: string): Promise<string> {
		const { generateText } = await import("ai");
		const model = await this.resolveModel();
		const result = await generateText({ model, prompt });
		return result.text;
	}

	private async resolveModel() {
		switch (this.config.provider) {
			case "anthropic": {
				const { anthropic } = await import("@ai-sdk/anthropic");
				return anthropic(this.config.model);
			}
			case "openai": {
				const { openai } = await import("@ai-sdk/openai");
				return openai(this.config.model);
			}
			default:
				throw new Error(`Unsupported AI SDK provider: ${this.config.provider}`);
		}
	}
}

/**
 * Create an adapter from a ProviderConfig, or null if the provider is unsupported.
 */
export function createAdapter(config: ProviderConfig): AiSdkAdapter | null {
	const supported = ["anthropic", "openai"];
	if (!supported.includes(config.provider)) return null;
	return new AiSdkAdapter(config);
}
