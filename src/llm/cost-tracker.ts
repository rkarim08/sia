import type { OperationRole } from "./provider-registry";

/** A single LLM API call record. */
export interface CostEntry {
	timestamp: number;
	provider: string;
	model: string;
	role: OperationRole;
	input_tokens: number;
	output_tokens: number;
	estimated_cost: number;
}

/**
 * Per-call cost tracking with optional daily budget enforcement.
 * Entries are kept in-memory; a future persistence layer can flush to the meta database.
 */
export class CostTracker {
	private entries: CostEntry[] = [];
	private readonly dailyBudget: number | undefined;

	constructor(dailyBudget?: number) {
		this.dailyBudget = dailyBudget;
	}

	/** Log a call and attach a timestamp. */
	logCall(entry: Omit<CostEntry, "timestamp">): void {
		this.entries.push({ ...entry, timestamp: Date.now() });
	}

	/** Get today's total spend (UTC day boundary). */
	getTodaySpend(): number {
		const todayStart = startOfDayUtc(Date.now());
		return this.entries
			.filter((e) => e.timestamp >= todayStart)
			.reduce((sum, e) => sum + e.estimated_cost, 0);
	}

	/** Check if the daily budget has been exceeded. */
	isBudgetExceeded(): boolean {
		if (this.dailyBudget === undefined) return false;
		return this.getTodaySpend() >= this.dailyBudget;
	}

	/** Get all entries, optionally filtered to those after a timestamp. */
	getEntries(since?: number): CostEntry[] {
		if (since === undefined) return [...this.entries];
		return this.entries.filter((e) => e.timestamp >= since);
	}

	/**
	 * Estimate cost in USD based on provider, model, and token counts.
	 * Uses approximate per-million-token pricing.
	 */
	static estimateCost(
		provider: string,
		model: string,
		inputTokens: number,
		outputTokens: number,
	): number {
		// Local models are free
		if (provider === "ollama" || provider === "local") {
			return 0;
		}

		const rates = getCostRates(provider, model);
		const inputCost = (inputTokens / 1_000_000) * rates.inputPerMillion;
		const outputCost = (outputTokens / 1_000_000) * rates.outputPerMillion;
		return inputCost + outputCost;
	}
}

/** Returns UTC midnight for the given timestamp. */
function startOfDayUtc(ts: number): number {
	const d = new Date(ts);
	d.setUTCHours(0, 0, 0, 0);
	return d.getTime();
}

interface CostRates {
	inputPerMillion: number;
	outputPerMillion: number;
}

/** Approximate per-million-token pricing. */
function getCostRates(provider: string, model: string): CostRates {
	if (provider === "anthropic") {
		if (model.includes("haiku")) {
			return { inputPerMillion: 0.8, outputPerMillion: 4.0 };
		}
		if (model.includes("sonnet")) {
			return { inputPerMillion: 3.0, outputPerMillion: 15.0 };
		}
		if (model.includes("opus")) {
			return { inputPerMillion: 15.0, outputPerMillion: 75.0 };
		}
	}

	if (provider === "openai") {
		if (model.includes("gpt-4o-mini")) {
			return { inputPerMillion: 0.15, outputPerMillion: 0.6 };
		}
		if (model.includes("gpt-4o")) {
			return { inputPerMillion: 2.5, outputPerMillion: 10.0 };
		}
	}

	// Fallback: generic cloud pricing
	return { inputPerMillion: 1.0, outputPerMillion: 5.0 };
}
