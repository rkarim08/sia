// Module: cuckoo-filter — Probabilistic set membership with deletion support
//
// Real fingerprint-based Cuckoo filter (Fan et al. 2014):
// - 16-bit fingerprints in Uint16Array buckets (4 slots/bucket)
// - FNV-1a hash: lower bits → bucket index, upper 16 bits → fingerprint
// - Alternate bucket via XOR with prime-multiplied fingerprint
// - Auxiliary Set<number> of 31-bit hashes for exact size tracking
// - Max 500 eviction kicks before declaring full
//
// Memory: ~328KB for 50K paths (128KB filter + 200KB hash set)
// FP rate: ~0.012% theoretical (16-bit fingerprints, 4 slots/bucket)

import type { SiaDb } from "@/graph/db-interface";

const BUCKET_SIZE = 4;
const MAX_KICKS = 500;
const MAX_BUCKETS = 65536;

function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash;
}

function nextPowerOfTwo(n: number): number {
	if (n <= 1) return 1;
	let p = 1;
	while (p < n) p <<= 1;
	return p;
}

export class CuckooFilter {
	private data: Uint16Array;
	private numBuckets: number;
	private hashes: Set<number>;
	private _size: number;

	constructor(capacity = 65536) {
		this.numBuckets = nextPowerOfTwo(Math.ceil(Math.max(capacity, 1) / BUCKET_SIZE / 0.95));
		if (this.numBuckets > MAX_BUCKETS) {
			throw new Error(
				`CuckooFilter capacity too large: ${capacity} requires ${this.numBuckets} buckets (max ${MAX_BUCKETS})`,
			);
		}
		this.data = new Uint16Array(this.numBuckets * BUCKET_SIZE);
		this.hashes = new Set();
		this._size = 0;
	}

	add(path: string): boolean {
		const hash = fnv1a(path);
		const smiHash = hash >>> 1;
		if (this.hashes.has(smiHash)) return true;

		const fp = hash >>> 16 || 1;
		const h1 = hash & (this.numBuckets - 1);
		const h2 = (h1 ^ (((fp * 0x5bd1e995) >>> 0) & (this.numBuckets - 1))) & (this.numBuckets - 1);

		if (this._bucketInsert(h1, fp)) {
			this.hashes.add(smiHash);
			this._size++;
			return true;
		}
		if (this._bucketInsert(h2, fp)) {
			this.hashes.add(smiHash);
			this._size++;
			return true;
		}

		let evictBucket = Math.random() < 0.5 ? h1 : h2;
		let evictFp = fp;

		for (let kick = 0; kick < MAX_KICKS; kick++) {
			const slotIdx = Math.floor(Math.random() * BUCKET_SIZE);
			const offset = evictBucket * BUCKET_SIZE + slotIdx;
			const evicted = this.data[offset];
			this.data[offset] = evictFp;
			evictFp = evicted;

			const altBucket =
				(evictBucket ^ (((evictFp * 0x5bd1e995) >>> 0) & (this.numBuckets - 1))) &
				(this.numBuckets - 1);

			if (this._bucketInsert(altBucket, evictFp)) {
				this.hashes.add(smiHash);
				this._size++;
				return true;
			}
			evictBucket = altBucket;
		}

		return false;
	}

	remove(path: string): boolean {
		const hash = fnv1a(path);
		const smiHash = hash >>> 1;
		if (!this.hashes.has(smiHash)) return false;

		const fp = hash >>> 16 || 1;
		const h1 = hash & (this.numBuckets - 1);
		const h2 = (h1 ^ (((fp * 0x5bd1e995) >>> 0) & (this.numBuckets - 1))) & (this.numBuckets - 1);

		if (this._bucketRemove(h1, fp)) {
			this.hashes.delete(smiHash);
			this._size--;
			return true;
		}
		if (this._bucketRemove(h2, fp)) {
			this.hashes.delete(smiHash);
			this._size--;
			return true;
		}
		return false;
	}

	contains(path: string): boolean {
		const hash = fnv1a(path);
		const fp = hash >>> 16 || 1;
		const h1 = hash & (this.numBuckets - 1);
		const h2 = (h1 ^ (((fp * 0x5bd1e995) >>> 0) & (this.numBuckets - 1))) & (this.numBuckets - 1);
		return this._bucketContains(h1, fp) || this._bucketContains(h2, fp);
	}

	clear(): void {
		this.data.fill(0);
		this.hashes.clear();
		this._size = 0;
	}

	get size(): number {
		return this._size;
	}

	private _bucketContains(bucket: number, fp: number): boolean {
		const base = bucket * BUCKET_SIZE;
		for (let i = 0; i < BUCKET_SIZE; i++) {
			if (this.data[base + i] === fp) return true;
		}
		return false;
	}

	private _bucketInsert(bucket: number, fp: number): boolean {
		const base = bucket * BUCKET_SIZE;
		for (let i = 0; i < BUCKET_SIZE; i++) {
			if (this.data[base + i] === 0) {
				this.data[base + i] = fp;
				return true;
			}
		}
		return false;
	}

	private _bucketRemove(bucket: number, fp: number): boolean {
		const base = bucket * BUCKET_SIZE;
		for (let i = 0; i < BUCKET_SIZE; i++) {
			if (this.data[base + i] === fp) {
				this.data[base + i] = 0;
				return true;
			}
		}
		return false;
	}

	static async fromDatabase(db: SiaDb): Promise<CuckooFilter> {
		const filter = new CuckooFilter();
		const { rows } = await db.execute("SELECT DISTINCT source_path FROM source_deps");
		for (const row of rows) {
			filter.add(row.source_path as string);
		}
		return filter;
	}
}
