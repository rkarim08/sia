// Module: entity-reconciler — merge, deduplicate, and classify GLiNER + regex extractions

import { classifyExtractionResult, type GlinerSpan } from "@/capture/gliner-extractor";

/** Input to the reconciliation process. */
export interface ReconciliationInput {
	glinerSpans: GlinerSpan[];
	regexEntities: GlinerSpan[];
}

/** Output of the reconciliation process. */
export interface ReconciliationResult {
	/** High-confidence entities to insert directly. */
	accepted: GlinerSpan[];
	/** Mid-confidence entities needing LLM confirmation. */
	needsConfirmation: GlinerSpan[];
	/** Low-confidence entities that were rejected. */
	rejected: GlinerSpan[];
}

/**
 * Reconcile extractions from GLiNER and regex, deduplicating and classifying.
 *
 * 1. Merge all spans into a single list.
 * 2. Deduplicate by `text::label` key (position-agnostic for cross-source dedup), keeping highest confidence.
 * 3. Classify each unique span as accept/confirm/reject based on per-label thresholds.
 */
export function reconcileExtractions(input: ReconciliationInput): ReconciliationResult {
	const allSpans = [...input.glinerSpans, ...input.regexEntities];

	// Deduplicate: key by text+label, keep highest confidence
	const dedupMap = new Map<string, GlinerSpan>();
	for (const span of allSpans) {
		const key = `${span.text}::${span.label}`;
		const existing = dedupMap.get(key);
		if (!existing || span.score > existing.score) {
			dedupMap.set(key, span);
		}
	}

	const accepted: GlinerSpan[] = [];
	const needsConfirmation: GlinerSpan[] = [];
	const rejected: GlinerSpan[] = [];

	for (const span of dedupMap.values()) {
		switch (classifyExtractionResult(span)) {
			case "accept":
				accepted.push(span);
				break;
			case "confirm":
				needsConfirmation.push(span);
				break;
			case "reject":
				rejected.push(span);
				break;
		}
	}

	return { accepted, needsConfirmation, rejected };
}
