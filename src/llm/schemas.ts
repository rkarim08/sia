import { z } from "zod";

/**
 * Unified extraction result schema.
 * Used by BOTH hooks extractors AND LLM provider — same shape regardless of source.
 */
export const SiaExtractionResult = z.object({
	entities: z.array(
		z.object({
			kind: z.enum(["Decision", "Convention", "Bug", "Solution", "Concept"]),
			name: z.string().min(3).max(200),
			content: z.string().min(10).max(2000),
			confidence: z.number().min(0).max(1),
			tags: z.array(z.string()).max(5),
			relates_to: z.array(z.string()),
		}),
	),
	_meta: z
		.object({
			source: z.enum(["hook", "llm", "claude-directive"]),
			input_tokens: z.number().optional(),
			output_tokens: z.number().optional(),
		})
		.optional(),
});

/** Consolidation decision for incoming vs existing entities. */
export const SiaConsolidationResult = z.object({
	decision: z.enum(["ADD", "UPDATE", "INVALIDATE", "NOOP"]),
	target_id: z.string().nullable(),
	reasoning: z.string().optional(),
});

/** Community or cluster summary result. */
export const SiaSummaryResult = z.object({
	summary: z.string().min(10).max(2000),
	key_entities: z.array(z.string()).max(10),
	confidence: z.number().min(0).max(1),
});

/** Fact validation result for freshness/correctness checks. */
export const SiaValidationResult = z.object({
	is_valid: z.boolean(),
	confidence: z.number().min(0).max(1),
	reasoning: z.string(),
	action: z.enum(["confirm", "invalidate", "flag_for_review"]),
});

export type SiaExtractionResultType = z.infer<typeof SiaExtractionResult>;
export type SiaConsolidationResultType = z.infer<typeof SiaConsolidationResult>;
export type SiaSummaryResultType = z.infer<typeof SiaSummaryResult>;
export type SiaValidationResultType = z.infer<typeof SiaValidationResult>;
