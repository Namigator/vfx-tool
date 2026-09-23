import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipe, parseRecipe, serializeRecipe, validateRecipe } from '../src/core/recipe.ts';
import { FAMILIES } from '../src/core/types.ts';
test('every built-in recipe survives save and reopen without changing authored values',()=>{for(const f of FAMILIES){const r=createRecipe(f);assert.deepEqual(parseRecipe(serializeRecipe(r)),r)}});
test('invalid and future files fail with specific field errors',()=>{assert.throws(()=>parseRecipe('{'),/JSON/);assert.throws(()=>validateRecipe({...createRecipe(),schemaVersion:2}),/schemaVersion/);assert.throws(()=>validateRecipe({...createRecipe(),seed:-1}),/seed/);assert.throws(()=>validateRecipe({...createRecipe(),target:[0,Infinity,0]}),/target/);const r=createRecipe();r.parameters.count=99999;assert.throws(()=>validateRecipe(r),/count/)});
test('unknown fields are discarded rather than treated as code or overrides',()=>{const r=createRecipe();assert.deepEqual(validateRecipe({...r,script:'alert(1)',parameters:{...r.parameters,renderer:{foo:1}}}),r)});

test('validation rejects fractional counts and negative heights',()=>{const r=createRecipe();assert.throws(()=>validateRecipe({...r,source:[0,-1,0]}),/source.y/);r.parameters.count=8.5;assert.throws(()=>validateRecipe(r),/count/)})
