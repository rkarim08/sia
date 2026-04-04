//
// Cross-encoder pair tokenizer: encodes (query, passage) as:
// [CLS] query_tokens [SEP] passage_tokens [SEP] [PAD]...
//
// token_type_ids: 0 for query (CLS through first SEP), 1 for passage

/** Result of pair tokenization. */
export interface PairTokenResult {
	inputIds: BigInt64Array;
	attentionMask: BigInt64Array;
	tokenTypeIds: BigInt64Array;
}

/**
 * Tokenize a query-passage pair for cross-encoder input.
 *
 * Format: [CLS] query_tokens [SEP] passage_tokens [SEP] [PAD]...
 * token_type_ids: 0 for query segment, 1 for passage segment
 */
export function tokenizePair(
	vocab: Map<string, number>,
	query: string,
	passage: string,
	maxSeqLength: number,
): PairTokenResult {
	const CLS_ID = 101;
	const SEP_ID = 102;
	const UNK_ID = 100;

	// Simple whitespace + lowercase tokenization (matches BERT WordPiece basics)
	function tokenizeText(text: string): number[] {
		const words = text.toLowerCase().replace(/([^\w\s])/g, " $1 ").trim().split(/\s+/);
		const ids: number[] = [];
		for (const word of words) {
			if (word === "") continue;
			ids.push(vocab.get(word) ?? UNK_ID);
		}
		return ids;
	}

	const queryTokens = tokenizeText(query);
	const passageTokens = tokenizeText(passage);

	// Budget: [CLS] + query + [SEP] + passage + [SEP] = 3 special tokens
	const maxContentLength = maxSeqLength - 3;

	// Split budget: give query at most half, passage gets the rest
	const maxQueryLen = Math.min(queryTokens.length, Math.floor(maxContentLength / 2));
	const maxPassageLen = Math.min(passageTokens.length, maxContentLength - maxQueryLen);

	const truncQuery = queryTokens.slice(0, maxQueryLen);
	const truncPassage = passageTokens.slice(0, maxPassageLen);

	const inputIds = new BigInt64Array(maxSeqLength);
	const attentionMask = new BigInt64Array(maxSeqLength);
	const tokenTypeIds = new BigInt64Array(maxSeqLength);

	let pos = 0;

	// [CLS]
	inputIds[pos] = BigInt(CLS_ID);
	attentionMask[pos] = 1n;
	tokenTypeIds[pos] = 0n;
	pos++;

	// Query tokens (type 0)
	for (const id of truncQuery) {
		inputIds[pos] = BigInt(id);
		attentionMask[pos] = 1n;
		tokenTypeIds[pos] = 0n;
		pos++;
	}

	// [SEP] (still type 0, marking end of query)
	inputIds[pos] = BigInt(SEP_ID);
	attentionMask[pos] = 1n;
	tokenTypeIds[pos] = 0n;
	pos++;

	// Passage tokens (type 1)
	for (const id of truncPassage) {
		inputIds[pos] = BigInt(id);
		attentionMask[pos] = 1n;
		tokenTypeIds[pos] = 1n;
		pos++;
	}

	// [SEP] (type 1, marking end of passage)
	inputIds[pos] = BigInt(SEP_ID);
	attentionMask[pos] = 1n;
	tokenTypeIds[pos] = 1n;
	pos++;

	// Remaining positions are [PAD] (already 0n by default)

	return { inputIds, attentionMask, tokenTypeIds };
}
