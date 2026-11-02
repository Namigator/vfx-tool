import test from 'node:test';
import assert from 'node:assert/strict';
import { fnv1a32Utf8 } from '../src/runtime/random.ts';

// Reference: FNV-1a over UTF-8 bytes, as the function computed before the ASCII fast path and memo.
const reference = (text: string) => {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
};

test('fnv1a32Utf8: fast path and memo give the byte-wise FNV-1a hash, again and again', () => {
  for (const text of ['', 'a', 'em-sparks#12/p:3', 'rs-ring|tick:42|i:7', 'ünïcødé ✨', 'mixed-ascii-then-é']) {
    assert.equal(fnv1a32Utf8(text), reference(text), text);
    assert.equal(fnv1a32Utf8(text), reference(text), `${text} (memoised)`);
  }
});
