import test from 'node:test';
import assert from 'node:assert/strict';
import { INTRO_SEEN_KEY, shouldShowIntro } from '../src/editor/introGate.ts';

const store = (seen: boolean) => ({ getItem: (k: string) => (seen && k === INTRO_SEEN_KEY ? '1' : null) });

test('first-visit intro: shows only on a clean first open', () => {
  assert.equal(shouldShowIntro(store(false), '', false), true);
  assert.equal(shouldShowIntro(store(true), '', false), false, 'already seen');
  assert.equal(shouldShowIntro(store(false), '', true), false, 'a saved draft means a returning visitor');
  assert.equal(shouldShowIntro(store(false), '?doc=x.json', false), false, 'document links (MCP, review) skip it');
  assert.equal(shouldShowIntro(store(false), '?demo=lightning', false), false);
  assert.equal(shouldShowIntro(store(false), '?intro=0', false), false, '?intro=0 turns it off');
  assert.equal(shouldShowIntro(undefined, '', false), true, 'no storage: still shows once per load');
  assert.equal(shouldShowIntro({ getItem: () => { throw new Error('blocked'); } }, '', false), false, 'blocked storage: never risk a repeat');
});
