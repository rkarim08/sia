import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTokenizer, tokenize } from "@/capture/tokenizer";

describe("tokenizer", () => {
	let tmpDir: string;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-tok-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	/**
	 * Build a minimal tokenizer.json matching the HuggingFace WordPiece format.
	 * Includes special tokens and a handful of real words for testing.
	 */
	function createMockTokenizerJson(dir: string): string {
		const vocab: Record<string, number> = {
			"[PAD]": 0,
			"[UNK]": 100,
			"[CLS]": 101,
			"[SEP]": 102,
			hello: 7592,
			world: 2088,
			the: 1996,
			quick: 4248,
			brown: 2829,
			fox: 4419,
			"##s": 2015,
			"##ing": 2075,
			test: 3231,
			"##ed": 2098,
		};

		const tokenizerJson = {
			model: {
				type: "WordPiece",
				vocab,
			},
		};

		const filePath = join(dir, "tokenizer.json");
		writeFileSync(filePath, JSON.stringify(tokenizerJson));
		return filePath;
	}

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// loadTokenizer loads vocabulary from tokenizer.json
	// ---------------------------------------------------------------

	it("loads vocabulary from tokenizer.json", () => {
		tmpDir = makeTmp();
		const tokPath = createMockTokenizerJson(tmpDir);
		const tokenizer = loadTokenizer(tokPath);

		expect(tokenizer.vocab).toBeInstanceOf(Map);
		expect(tokenizer.vocab.size).toBeGreaterThan(0);
		expect(tokenizer.vocab.get("hello")).toBe(7592);
		expect(tokenizer.vocab.get("[CLS]")).toBe(101);
	});

	// ---------------------------------------------------------------
	// tokenize prepends [CLS] and appends [SEP]
	// ---------------------------------------------------------------

	it("prepends [CLS] (101) and appends [SEP] (102)", () => {
		tmpDir = makeTmp();
		const tokPath = createMockTokenizerJson(tmpDir);
		const tokenizer = loadTokenizer(tokPath);

		const result = tokenize(tokenizer, "hello world", 16);

		// First token must be [CLS]
		expect(result.inputIds[0]).toBe(101n);

		// Find [SEP] — it follows the last real token
		// "hello" -> 7592, "world" -> 2088, so [CLS] hello world [SEP] = indices 0,1,2,3
		expect(result.inputIds[3]).toBe(102n);
	});

	// ---------------------------------------------------------------
	// output length matches maxLength with proper padding
	// ---------------------------------------------------------------

	it("output length matches maxLength and pads correctly", () => {
		tmpDir = makeTmp();
		const tokPath = createMockTokenizerJson(tmpDir);
		const tokenizer = loadTokenizer(tokPath);

		const maxLen = 32;
		const result = tokenize(tokenizer, "hello", maxLen);

		expect(result.inputIds.length).toBe(maxLen);
		expect(result.attentionMask.length).toBe(maxLen);

		// [CLS] hello [SEP] = 3 real tokens
		expect(result.attentionMask[0]).toBe(1n); // [CLS]
		expect(result.attentionMask[1]).toBe(1n); // hello
		expect(result.attentionMask[2]).toBe(1n); // [SEP]

		// Padding positions
		expect(result.attentionMask[3]).toBe(0n);
		expect(result.inputIds[3]).toBe(0n); // [PAD]
	});

	// ---------------------------------------------------------------
	// attention_mask is 1 for real tokens, 0 for padding
	// ---------------------------------------------------------------

	it("attention_mask is 1 for real tokens, 0 for padding", () => {
		tmpDir = makeTmp();
		const tokPath = createMockTokenizerJson(tmpDir);
		const tokenizer = loadTokenizer(tokPath);

		const result = tokenize(tokenizer, "the quick brown fox", 16);

		// Count real tokens: [CLS] the quick brown fox [SEP] = 6
		let realCount = 0;
		let padCount = 0;
		for (let i = 0; i < 16; i++) {
			if (result.attentionMask[i] === 1n) realCount++;
			else padCount++;
		}

		expect(realCount).toBe(6);
		expect(padCount).toBe(10);
	});

	// ---------------------------------------------------------------
	// unknown tokens map to [UNK] (100)
	// ---------------------------------------------------------------

	it("maps unknown tokens to [UNK] (100)", () => {
		tmpDir = makeTmp();
		const tokPath = createMockTokenizerJson(tmpDir);
		const tokenizer = loadTokenizer(tokPath);

		const result = tokenize(tokenizer, "xyzzy", 8);

		// [CLS] then sub-word pieces of "xyzzy" (all unknown) then [SEP]
		expect(result.inputIds[0]).toBe(101n); // [CLS]

		// "xyzzy" is not in vocab and no sub-word pieces match, so each char -> [UNK]
		// At least one [UNK] should appear
		const ids = Array.from(result.inputIds);
		expect(ids.some((id) => id === 100n)).toBe(true);
	});

	// ---------------------------------------------------------------
	// empty text produces only [CLS] [SEP] with padding
	// ---------------------------------------------------------------

	it("handles empty text correctly", () => {
		tmpDir = makeTmp();
		const tokPath = createMockTokenizerJson(tmpDir);
		const tokenizer = loadTokenizer(tokPath);

		const result = tokenize(tokenizer, "", 8);

		expect(result.inputIds[0]).toBe(101n); // [CLS]
		expect(result.inputIds[1]).toBe(102n); // [SEP]
		expect(result.attentionMask[0]).toBe(1n);
		expect(result.attentionMask[1]).toBe(1n);
		expect(result.attentionMask[2]).toBe(0n);
	});

	// ---------------------------------------------------------------
	// truncation when text exceeds maxLength
	// ---------------------------------------------------------------

	it("truncates when text exceeds maxLength", () => {
		tmpDir = makeTmp();
		const tokPath = createMockTokenizerJson(tmpDir);
		const tokenizer = loadTokenizer(tokPath);

		// Very short maxLength to force truncation
		const result = tokenize(tokenizer, "hello world the quick brown fox", 6);

		expect(result.inputIds.length).toBe(6);
		expect(result.inputIds[0]).toBe(101n); // [CLS]

		// Last real token before padding should be [SEP]
		// Find the last attention=1 position
		let lastReal = 0;
		for (let i = 0; i < 6; i++) {
			if (result.attentionMask[i] === 1n) lastReal = i;
		}
		expect(result.inputIds[lastReal]).toBe(102n); // [SEP]
	});

	// ---------------------------------------------------------------
	// default maxLength is 128
	// ---------------------------------------------------------------

	it("uses default maxLength of 128", () => {
		tmpDir = makeTmp();
		const tokPath = createMockTokenizerJson(tmpDir);
		const tokenizer = loadTokenizer(tokPath);

		const result = tokenize(tokenizer, "test");

		expect(result.inputIds.length).toBe(128);
		expect(result.attentionMask.length).toBe(128);
	});
});
