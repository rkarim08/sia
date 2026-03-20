# Real Probabilistic Cuckoo Filter — Design Spec

**Date:** 2026-03-19
**Status:** Approved
**Replaces:** Set-backed `CuckooFilter` in `src/freshness/cuckoo-filter.ts`
**Reference:** Fan et al. 2014, "Cuckoo Filter: Practically Better Than Bloom"

---

## 1. Problem

The current `CuckooFilter` uses a `Set<string>` as its backing store. While functionally correct (zero false positives, O(1) lookup), it consumes ~3MB for 50K paths due to string storage overhead. The Phase 15 spec calls for a probabilistic filter that uses ~100KB. A previous attempt with 8-bit fingerprints failed at 77% false positive rate due to fingerprint space exhaustion and a broken alternate-bucket hash function.

## 2. Goals

- Replace `Set<string>` with a real fingerprint-based Cuckoo filter
- Memory target: ~500KB for 50K paths (reasonable reduction from 3MB, not strict 100KB)
- False positive rate: < 1% (theoretical ~0.012% with 16-bit fingerprints)
- Exact `size` tracking via auxiliary hash set
- Same public API — drop-in replacement, no consumer changes needed
- Support deletion (the reason Cuckoo filter was chosen over Bloom filter)

## 3. Data Structure Layout

### 3.1 Bucket Array

A flat `Uint16Array` of `numBuckets * BUCKET_SIZE` entries. Each contiguous group of `BUCKET_SIZE` (4) entries forms one bucket. A slot value of `0` means empty. Fingerprints are 16-bit unsigned integers, never 0.

### 3.2 Bucket Count

`numBuckets = nextPowerOfTwo(ceil(capacity / BUCKET_SIZE / 0.95))`

Power-of-two bucket count enables bitmask modulo (`hash & (numBuckets - 1)`) instead of expensive integer division.

```typescript
function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}
```

For 50K items: `ceil(50000 / 4 / 0.95) = 13158` -> `16384` buckets.
Filter memory: `16384 * 4 * 2 bytes = 128KB`.

### 3.3 Auxiliary Hash Set

A `Set<number>` of 31-bit FNV-1a hashes (one per distinct item). Hashes are masked to 31 bits (`hash >>> 1`) to stay within V8's SMI (Small Integer) range — values above 2^31 would be heap-allocated as doubles, inflating memory from ~200KB to ~2.5MB. Provides:
- Dedup: prevents double-counting when the same path is added twice
- Accurate `size` counter
- Efficient `remove` validation (check membership before scanning buckets)

Memory at 50K items: ~200KB (V8 stores SMI integers inline in Sets, ~4 bytes per entry + Set overhead).

### 3.4 Total Memory

~328KB for 50K paths. Well under the ~500KB budget.

### 3.5 Constructor

```typescript
constructor(capacity?: number)
```

- Default capacity: `65536` (handles 50K paths comfortably)
- Computes `numBuckets` as described in 3.2
- Allocates `Uint16Array(numBuckets * BUCKET_SIZE)` zeroed
- Initializes empty `Set<number>` for auxiliary hash set

## 4. Hash Functions

### 4.1 Primary Hash — FNV-1a 32-bit

```typescript
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}
```

Used for both bucket index and fingerprint derivation. A single hash call per operation.

### 4.2 Fingerprint Derivation

```typescript
fingerprint = (fnv1a(path) >>> 16) || 1
```

Upper 16 bits of the 32-bit hash. The lower bits determine the bucket index, so using upper bits for the fingerprint ensures independence between bucket placement and fingerprint value. `|| 1` guarantees non-zero (0 = empty slot sentinel).

### 4.3 Primary Bucket Index

```typescript
h1 = fnv1a(path) & (numBuckets - 1)
```

Lower bits of the hash, masked to bucket range.

### 4.4 Alternate Bucket Index

```typescript
h2 = (h1 ^ ((fp * 0x5bd1e995) >>> 0)) & (numBuckets - 1)
```

XOR of primary bucket with the fingerprint multiplied by a large prime (Murmur hash constant). This disperses fingerprint bits uniformly across the full bucket range without needing a second string hash.

**Why this fixes the previous bug:** The earlier implementation used `fnv1a(String(fp))` which converted a 16-bit integer to a 1-5 character string — terrible hash input that collapsed the bucket space. Direct integer multiplication produces uniform distribution.

**Symmetry property:** Given only a fingerprint and one bucket index, the alternate bucket can be computed: `alt = (bucket ^ ((fp * 0x5bd1e995) >>> 0)) & mask`. This is essential for cuckoo eviction (you have the fingerprint and current bucket, and need the other bucket). Note the outer parentheses — `&` has lower precedence than `^` in JavaScript, so the mask must wrap the entire XOR expression.

## 5. Operations

### 5.1 `add(path: string): boolean`

1. `hash = fnv1a(path)`, `fp = (hash >>> 16) || 1`, `h1 = hash & (numBuckets - 1)`
2. If `hash` already in auxiliary Set → return `true` (dedup, no size change)
3. `h2 = (h1 ^ ((fp * 0x5bd1e995) >>> 0)) & (numBuckets - 1)`
4. Scan bucket `h1` for empty slot (value `0`) → write `fp`, add `hash` to Set, `_size++`, return `true`
5. Scan bucket `h2` for empty slot → same
6. Both full: cuckoo eviction — pick random bucket using `Math.random() < 0.5 ? h1 : h2`, pick random slot via `Math.floor(Math.random() * BUCKET_SIZE)`, swap `fp` with existing fingerprint, compute alternate bucket for evicted fingerprint, try inserting there. Repeat up to `MAX_KICKS` (500) times. The 500 kick limit is the standard value from Fan et al. 2014.
7. On success: add `hash` to Set, `_size++`, return `true`
8. On failure (500 kicks exhausted): return `false` (filter full)

### 5.2 `contains(path: string): boolean`

1. `hash = fnv1a(path)`, `fp = (hash >>> 16) || 1`, `h1`, `h2` as above
2. Scan 4 slots in bucket `h1` — if any equals `fp`, return `true`
3. Scan 4 slots in bucket `h2` — if any equals `fp`, return `true`
4. Return `false`

Cost: exactly 8 slot reads (2 buckets * 4 slots). No branching except the match check.

### 5.3 `remove(path: string): boolean`

1. `hash = fnv1a(path)`, `fp`, `h1`, `h2` as above
2. If `hash` not in auxiliary Set → return `false` (item was never added)
3. Scan bucket `h1` for first occurrence of `fp` → set to `0`, remove `hash` from Set, `_size--`, return `true`
4. Scan bucket `h2` for first occurrence of `fp` → same
5. Return `false` (shouldn't happen if auxiliary Set is consistent)

### 5.4 `clear(): void`

Zero the entire `Uint16Array` (`.fill(0)`), clear auxiliary Set, `_size = 0`.

### 5.5 `get size(): number`

Returns `_size` directly. Accurate because the auxiliary Set prevents double-counting.

### 5.6 `static fromDatabase(db: SiaDb): Promise<CuckooFilter>`

Unchanged from current implementation — query `SELECT DISTINCT source_path FROM source_deps`, call `add()` for each row.

## 6. Edge Cases

### 6.1 31-bit Hash Collisions in Auxiliary Set

Two different strings with the same 31-bit hash (FNV-1a masked to `>>> 1`) will be treated as duplicates by the auxiliary Set. The second `add()` will return `true` without inserting the fingerprint.

Probability per pair: 1 / 2^31 ≈ 4.7 × 10^-10. At 50K items, expected collisions: `C(50000, 2) / 2^31 ≈ 0.58`. Less than 1 expected collision across the entire working set — negligible.

### 6.4 `h1 == h2` Degenerate Case

When `((fp * 0x5bd1e995) >>> 0) & mask` equals 0, both bucket indices are the same. The filter scans the same bucket twice and has half the eviction space. This is rare (probability `1 / numBuckets`) and self-correcting — affected items just have slightly lower eviction tolerance. No special handling needed.

### 6.5 Capacity Ceiling

The fingerprint uses bits [16..31] and the bucket index uses bits [0..13] (for 16384 buckets). If `numBuckets > 65536`, the bucket index would consume bits used by the fingerprint, breaking independence. The constructor should assert `numBuckets <= 65536` or document that capacity above `65536 * 4 * 0.95 = 248,832` is unsupported.

### 6.2 Fingerprint Collisions in Buckets

Two different strings that hash to the same bucket AND produce the same 16-bit fingerprint will be indistinguishable in the filter. This is the source of false positives.

Theoretical FP rate per lookup: `2 * BUCKET_SIZE / 2^16 = 8 / 65536 ≈ 0.012%`. At 10K test lookups, expected false positives: ~1.2.

### 6.3 Filter Full

If `add()` returns `false`, the caller should handle gracefully. In Sia's usage, `fromDatabase` would log a warning and the filter would still work for all items that were successfully added — items that failed to add simply won't be in the filter, meaning their files won't get the fast-reject optimization (they'll fall through to the SQLite query, which is correct but slower).

## 7. Public API (Unchanged)

```typescript
class CuckooFilter {
  constructor(capacity?: number);     // default 65536
  add(path: string): boolean;         // returns false if full
  remove(path: string): boolean;      // returns false if not found
  contains(path: string): boolean;    // O(1), may have false positives
  clear(): void;
  get size(): number;                 // exact count of distinct items
  static fromDatabase(db: SiaDb): Promise<CuckooFilter>;
}
```

**Breaking changes:** `add()` now returns `boolean` (was `void`) and `remove()` now returns `boolean` (was `void`). The callers (`fromDatabase` for `add`, `file-watcher-layer.ts` for `remove`) ignore the return values. No consumer changes needed.

## 8. Testing Strategy

### 8.1 Unit Tests (replace existing test file)

1. **Basic ops:** add + contains true, unknown contains false, remove + contains false, clear empties
2. **Dedup:** Same path added twice → `size` unchanged, still contains the item
3. **Alternate bucket:** Fill h1 bucket to capacity (4 items sharing same h1), add a 5th item with same h1 → must go to h2, verify contains finds it
4. **Eviction:** Fill a small filter (64 buckets) to ~90% capacity, verify all items are found via contains
5. **Filter full:** Tiny filter (4 buckets = 16 total slots), add 17+ items → eventually returns false
6. **False positive rate:** Add 50K items to default-capacity filter, test 10K non-inserted items, assert FP rate < 0.1% (theoretical is 0.012%; threshold at 0.1% catches 8x regressions while leaving headroom for hash variance)
7. **fromDatabase:** Seed source_deps, build filter, verify contents and size
8. **Remove safety:** Add two items with different strings, remove one, verify the other is still found
9. **Eviction then remove:** Fill bucket h1 to force eviction to h2, then remove the evicted item — verify it's no longer found
10. **Capacity guard:** Constructing with capacity > 248832 should throw or clamp

### 8.2 No Integration Tests Needed

Pure data structure with one DB integration point (`fromDatabase`), already covered by unit tests.

## 9. Files Changed

| File | Action |
|------|--------|
| `src/freshness/cuckoo-filter.ts` | Replace implementation |
| `tests/unit/freshness/cuckoo-filter.test.ts` | Replace test suite |

No other files change — the public API is identical.
