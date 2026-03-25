// Module: llm-client — Shared LLM client with Anthropic SDK + air-gapped fallback
import type { SiaConfig } from "@/shared/config";

/** LLM client interface for summarization and classification tasks. */
export interface LlmClient {
	summarize(prompt: string): Promise<string>;
	classify(prompt: string, options: string[]): Promise<string>;
}

/** Rate limiter state */
interface RateLimiter {
	tokens: number;
	maxTokens: number;
	refillRate: number; // tokens per ms
	lastRefill: number;
}

function createRateLimiter(maxPerMinute: number): RateLimiter {
	return {
		tokens: maxPerMinute,
		maxTokens: maxPerMinute,
		refillRate: maxPerMinute / 60000,
		lastRefill: Date.now(),
	};
}

async function acquireToken(limiter: RateLimiter): Promise<void> {
	const now = Date.now();
	const elapsed = now - limiter.lastRefill;
	limiter.tokens = Math.min(limiter.maxTokens, limiter.tokens + elapsed * limiter.refillRate);
	limiter.lastRefill = now;

	if (limiter.tokens < 1) {
		const waitMs = (1 - limiter.tokens) / limiter.refillRate;
		await new Promise((r) => setTimeout(r, waitMs));
		limiter.tokens = 0;
	} else {
		limiter.tokens -= 1;
	}
}

/** Air-gapped/fallback client that uses heuristic string concatenation. */
export function createFallbackClient(): LlmClient {
	return {
		async summarize(prompt: string): Promise<string> {
			const lines = prompt.split("\n").filter((l) => l.trim().length > 0);
			return lines.slice(0, 5).join("; ").slice(0, 500);
		},
		async classify(_prompt: string, options: string[]): Promise<string> {
			return options[0] ?? "unknown";
		},
	};
}

/** Create an LLM client backed by the Anthropic SDK with rate limiting. */
export function createLlmClient(config: SiaConfig): LlmClient {
	// Air-gapped mode or no API key → fallback
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (config.airGapped || !apiKey) {
		return createFallbackClient();
	}

	const model = config.captureModel ?? "claude-haiku-4-5-20251001";
	const limiter = createRateLimiter(10);
	let anthropicClient: {
		messages: {
			create: (opts: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }> }>;
		};
	} | null = null;

	async function getClient() {
		if (!anthropicClient) {
			const { default: Anthropic } = await import("@anthropic-ai/sdk");
			anthropicClient = new Anthropic({ apiKey }) as unknown as typeof anthropicClient;
		}
		return anthropicClient!;
	}

	return {
		async summarize(prompt: string): Promise<string> {
			try {
				await acquireToken(limiter);
				const client = await getClient();
				const response = await client.messages.create({
					model,
					max_tokens: 300,
					messages: [{ role: "user", content: prompt }],
				});
				const text = response.content[0]?.text;
				return text ?? createFallbackClient().summarize(prompt);
			} catch (err) {
				console.warn("LLM summarize failed, using fallback:", err);
				return createFallbackClient().summarize(prompt);
			}
		},
		async classify(prompt: string, options: string[]): Promise<string> {
			try {
				await acquireToken(limiter);
				const client = await getClient();
				const response = await client.messages.create({
					model,
					max_tokens: 50,
					messages: [
						{
							role: "user",
							content: `${prompt}\n\nRespond with exactly one of: ${options.join(", ")}`,
						},
					],
				});
				const text = (response.content[0]?.text ?? "").trim().toLowerCase();
				const match = options.find((o) => text.includes(o.toLowerCase()));
				return match ?? options[0] ?? "unknown";
			} catch (err) {
				console.warn("LLM classify failed, using fallback:", err);
				return options[0] ?? "unknown";
			}
		},
	};
}
