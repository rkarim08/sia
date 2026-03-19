import { existsSync, readFileSync } from "node:fs";
import type { CaptureMode, OperationRole, ProviderConfig } from "./provider-registry";

/** Full LLM configuration for Sia. */
export interface SiaLlmConfig {
	capture: {
		mode: CaptureMode;
		hookPort: number;
	};
	providers: Record<OperationRole, ProviderConfig>;
	fallback: {
		enabled: boolean;
		chain: string[];
		maxRetries: number;
	};
	costTracking: {
		enabled: boolean;
		budgetPerDay: number;
	};
}

/** Get the built-in default config (hooks mode, Anthropic for summarize/validate). */
export function getDefaultLlmConfig(): SiaLlmConfig {
	return {
		capture: {
			mode: "hooks",
			hookPort: 4521,
		},
		providers: {
			summarize: { provider: "anthropic", model: "claude-sonnet-4" },
			validate: { provider: "ollama", model: "qwen2.5-coder:7b" },
			extract: { provider: "anthropic", model: "claude-haiku-4-5" },
			consolidate: { provider: "anthropic", model: "claude-haiku-4-5" },
		},
		fallback: {
			enabled: true,
			chain: ["anthropic", "openai", "ollama"],
			maxRetries: 3,
		},
		costTracking: {
			enabled: true,
			budgetPerDay: 5.0,
		},
	};
}

/**
 * Load config from a YAML-like config file path, or return defaults.
 * Currently supports a simple JSON config; full YAML support can be added later.
 */
export function loadLlmConfig(configPath?: string): SiaLlmConfig {
	const defaults = getDefaultLlmConfig();

	if (!configPath || !existsSync(configPath)) {
		return defaults;
	}

	try {
		const raw = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<SiaLlmConfig>;
		return mergeConfig(defaults, parsed);
	} catch {
		// If the file can't be parsed, return defaults
		return defaults;
	}
}

/** Deep-merge a partial config onto the defaults. */
function mergeConfig(defaults: SiaLlmConfig, partial: Partial<SiaLlmConfig>): SiaLlmConfig {
	return {
		capture: {
			...defaults.capture,
			...(partial.capture ?? {}),
		},
		providers: {
			...defaults.providers,
			...(partial.providers ?? {}),
		},
		fallback: {
			...defaults.fallback,
			...(partial.fallback ?? {}),
		},
		costTracking: {
			...defaults.costTracking,
			...(partial.costTracking ?? {}),
		},
	};
}
