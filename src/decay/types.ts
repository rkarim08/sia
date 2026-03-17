// Module: decay/types — shared types for maintenance work units

/** Result of processing a single batch within a work unit. */
export interface BatchResult {
	/** Number of items processed in this batch. */
	processed: number;
	/** Whether more work remains after this batch. */
	remaining: boolean;
}

/** Result of a full importance decay run. */
export interface DecayResult {
	/** Number of entities processed. */
	processed: number;
	/** Wall-clock duration in milliseconds. */
	durationMs: number;
}
