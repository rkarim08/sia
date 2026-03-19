/** Configuration for the reliability wrapper. */
export interface ReliabilityConfig {
	maxRetries: number;
	fallbackChain: string[];
	circuitBreakerThreshold: number;
	circuitBreakerWindowMs: number;
}

export interface CircuitBreakerOptions {
	/** Failure ratio (0-1) that triggers the circuit to open. Default 0.5. */
	threshold?: number;
	/** Window in ms for tracking failures. Default 60000. */
	windowMs?: number;
	/** Minimum number of operations before the breaker can trip. Default 3. */
	minSamples?: number;
}

/**
 * Circuit breaker that tracks success/failure ratios and opens
 * the circuit when the failure rate exceeds the configured threshold.
 */
export class CircuitBreaker {
	private failures = 0;
	private successes = 0;
	private state: "closed" | "open" | "half-open" = "closed";
	private lastFailureTime = 0;
	private readonly threshold: number;
	private readonly windowMs: number;
	private readonly minSamples: number;

	constructor(options?: CircuitBreakerOptions) {
		this.threshold = options?.threshold ?? 0.5;
		this.windowMs = options?.windowMs ?? 60000;
		this.minSamples = options?.minSamples ?? 3;
	}

	/** Whether the circuit is open (rejecting calls). */
	isOpen(): boolean {
		if (this.state === "open") {
			// Check if the window has expired — transition to half-open
			if (Date.now() - this.lastFailureTime > this.windowMs) {
				this.state = "half-open";
				return false;
			}
			return true;
		}
		return false;
	}

	/** Record a successful operation. Closes the circuit if half-open. */
	recordSuccess(): void {
		this.successes++;
		if (this.state === "half-open") {
			this.state = "closed";
		}
	}

	/** Record a failed operation. Opens the circuit if threshold exceeded and minimum samples met. */
	recordFailure(): void {
		this.failures++;
		this.lastFailureTime = Date.now();
		const total = this.failures + this.successes;
		if (total >= this.minSamples && this.failures / total >= this.threshold) {
			this.state = "open";
		}
	}

	/** Reset all counters and close the circuit. */
	reset(): void {
		this.failures = 0;
		this.successes = 0;
		this.state = "closed";
		this.lastFailureTime = 0;
	}

	/** Get diagnostic stats. */
	getStats(): { state: string; failures: number; successes: number } {
		// Refresh state check (window may have expired)
		if (this.state === "open" && Date.now() - this.lastFailureTime > this.windowMs) {
			this.state = "half-open";
		}
		return {
			state: this.state,
			failures: this.failures,
			successes: this.successes,
		};
	}
}

/**
 * Wrap an async operation with retry + circuit breaker.
 * Returns the result or throws after all retries are exhausted.
 */
export async function withReliability<T>(
	operation: () => Promise<T>,
	breaker: CircuitBreaker,
	maxRetries = 3,
): Promise<T> {
	if (breaker.isOpen()) {
		throw new Error("Circuit breaker is open — request rejected");
	}

	let lastError: Error | undefined;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const result = await operation();
			breaker.recordSuccess();
			return result;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			breaker.recordFailure();

			// If the circuit just opened, stop retrying
			if (breaker.isOpen()) {
				break;
			}
		}
	}

	throw lastError ?? new Error("withReliability: all retries exhausted");
}
