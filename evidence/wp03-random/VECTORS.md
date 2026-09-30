# WP03 random primitive vectors

Status: [UNVERIFIED] — authored by claude-controls with file tools only; no command was run. Manager must execute tests and independently recompute.

Source of truth: docs/v2-plan/24-ALGORITHMS.md "Exact random identity". Implementation: src/runtime/random.ts. Tests: tests/v2-random.test.ts.

## Derivation (not copied from implementation output)

1. FNV-1a 32 constants: the published vectors from the FNV reference test suite (Landon Noll):
   - `""` → `0x811c9dc5` (offset basis, zero bytes)
   - `"a"` → `0xe40c292c`, `"b"` → `0xe70c2de5`, `"foobar"` → `0xbf9cf968`
2. UTF-8: bytes are hand-listed from the Unicode encoding rules, and hashed by a BigInt reference in the test:
   - U+00E9 `é` → `C3 A9`; U+20AC `€` → `E2 82 AC`; U+1F600 → `F0 9F 98 80`
3. Mulberry32 first output: BigInt reference in the test, all values kept unsigned mod 2^32 (JS int32 bitwise ops are equivalent mod 2^32):
   `a=(seed+0x6D2B79F5) mod 2^32; t=((a^(a>>15))*(a|1)) mod 2^32; t=t^((t+((t^(t>>7))*(t|61))) mod 2^32); out=(t^(t>>14))/2^32`.
   Seeds checked: 0, 1, 42, 0x7fffffff, 0x80000000, 0xffffffff, 0x92d68ca2.
4. Tuple text, derived by hand from the plan's ordered array:
   - seed 0: `[2,0,"stream_a","",0,"velocityX",0]`
   - seed 42: `[2,42,"stream_a","",0,"velocityX",0]`
   - sample = refMulberry(refFnv(ASCII bytes of tuple text)).
5. Event keys (hand-written expected strings):
   - schedule: `["schedule","sched_1",30,2]`
   - parent (first five tuple fields): `[2,42,"emit_1","[\"schedule\",\"sched_1\",30,2]",3]`
   - particle: `["particle",<parent text>,"death",0]`

No numeric sample value is listed here as a literal because none was computed by hand; the manager's BigInt recomputation of items 3–4 is the independent check.

## Suggested manager recomputation (BigInt)
```js
const M=1n<<32n,u=x=>((x%M)+M)%M;
const fnv=s=>{let h=2166136261n;for(const b of new TextEncoder().encode(s))h=u((h^BigInt(b))*16777619n);return h};
const mb=s=>{const a=u(s+0x6d2b79f5n);let t=u((a^(a>>15n))*(a|1n));t=u(t^u(t+u((t^(t>>7n))*(t|61n))));return Number(t^(t>>14n))/2**32};
for (const seed of [0,42]) { const h=fnv(`[2,${seed},"stream_a","",0,"velocityX",0]`); console.log(seed, h, mb(h)); }
```

## Manager-run fixed outputs
[RAN] Independently recomputed using manager-reference.mjs (BigInt modulo arithmetic, hand-listed UTF-8 byte arrays); exact output in manager-vectors.json. These are now literal test expectations in v2-random.test.ts, alongside the broader reference comparisons. This supersedes the initial omission above.

- FNV UTF-8: é = 513665217; € = 697271083; U+1F600 = 866293256.
- Mulberry first seed0: uint32 1144304738; sample 0.26642920868471265.
- Mulberry first seed42: uint32 2581720956; sample 0.6011037519201636.
- Tuple [2,0,"stream_a","",0,"velocityX",0]: hash1368964078, output3409570521 / 4294967296.
- Tuple [2,42,"stream_a","",0,"velocityX",0]: hash389257244, output3477470563 / 4294967296.
