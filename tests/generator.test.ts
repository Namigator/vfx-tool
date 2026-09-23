import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleEffect, mulberry32 } from '../src/core/generator.ts';
import { FAMILIES } from '../src/core/types.ts';
import type { Recipe, Family } from '../src/core/types.ts';
const recipe=(family:Family='lightning'):Recipe=>({schemaVersion:1,generatorVersion:'1.0.0',id:'test',name:'Test',family,seed:42,source:[-3,1.3,0],target:[3,0,0],parameters:{scale:1,intensity:1,count:80,spread:1,speed:1,turbulence:1,branches:12,width:0.04,charge:0.4,active:1,decay:0.6,color:'#55bbff',secondaryColor:'#ffffff',volume:0.5,pitch:1}});
const geometry=(r:Recipe,t:number)=>{const f=sampleEffect(r,t);return {strokes:f.strokes,particles:f.particles,solids:f.solids,rings:f.rings};};
const empty=(r:Recipe,t:number)=>{const f=sampleEffect(r,t);for(const key of ['strokes','particles','solids','rings','lights'] as const)assert.equal(f[key].length,0);};
function finite(value:unknown):void {
  if(typeof value==='number') assert.ok(Number.isFinite(value),`Non-finite output ${value}`);
  else if(Array.isArray(value))value.forEach(finite);
  else if(value && typeof value==='object')Object.values(value).forEach(finite);
}
test('PRNG deterministic, bounded, and seed sensitive',()=>{
  const a=mulberry32(42), b=mulberry32(42), c=mulberry32(43);
  const av=Array.from({length:100},a),bv=Array.from({length:100},b),cv=Array.from({length:100},c);
  assert.deepEqual(av,bv);assert.notDeepEqual(av,cv);assert.ok(av.every(n=>n>=0&&n<1));
});
for(const family of FAMILIES){
  test(`${family}: deterministic, seed-sensitive geometry and independent sample schedule`,()=>{
    const r=recipe(family), before=JSON.stringify(r), expected=sampleEffect(r,0.75);
    sampleEffect(r,1.9);sampleEffect(r,0.2);sampleEffect(recipe('fire'),0.95);
    assert.deepEqual(sampleEffect(r,0.75),expected);
    assert.notDeepEqual(geometry({...r,seed:43},0.75),geometry(r,0.75));
    assert.equal(JSON.stringify(r),before,'Sampling mutated recipe');
    assert.deepEqual(sampleEffect(r,0.751),sampleEffect(r,0.75),'Time should be quantized to 60 Hz');
  });
  test(`${family}: coherent lifecycle and finite bounded output`,()=>{
    const r=recipe(family);empty(r,0);empty(r,-1);empty(r,2);empty(r,5);
    assert.equal(sampleEffect(r,0).phase,'ready');assert.equal(sampleEffect(r,0.2).phase,'charging');
    assert.equal(sampleEffect(r,0.75).phase,'active');assert.equal(sampleEffect(r,1.7).phase,'decay');assert.equal(sampleEffect(r,2).phase,'finished');
    for(let frame=0;frame<=120;frame++){
      const f=sampleEffect(r,frame/60);finite(f);
      assert.ok(f.strokes.length<=130);assert.ok(f.particles.length<=400);assert.ok(f.solids.length<=100);
      for(const list of [f.strokes,f.particles,f.solids,f.rings])for(const item of list)assert.ok(item.opacity>=0&&item.opacity<=1);
    }
    const huge=structuredClone(r);huge.parameters.count=1e7;huge.parameters.branches=1e7;
    const f=sampleEffect(huge,0.8);finite(f);assert.ok(f.particles.length<=401);assert.ok(f.strokes.length<=66);assert.ok(f.solids.length<=100);
  });
}
test('lightning main strand pins both endpoints exactly',()=>{
  const r=recipe(), main=sampleEffect(r,0.8).strokes[0];
  assert.deepEqual(main.points[0],r.source);
  const last=main.points.at(-1)!;last.forEach((n,i)=>assert.ok(Math.abs(n-r.target[i])<1e-12));
});
test('different families produce different frame geometries',()=>{
  const encoded=FAMILIES.map(f=>JSON.stringify(geometry(recipe(f),0.8)));
  assert.equal(new Set(encoded).size,FAMILIES.length);
});

test('lightning branches remain attached to a point on the main strand',()=>{
 const r=recipe();for(const t of [.5,.8,1.2,1.7]){const f=sampleEffect(r,t),main=f.strokes[0];for(const branch of f.strokes.slice(2))assert.ok(main.points.some(p=>p.every((n,i)=>n===branch.points[0][i])));}
});
test('emitting particle families stop recycling particles during decay',()=>{
 for(const family of ['lightning','fire','water','wind','shadow','poison'] as Family[]){const r=recipe(family);r.parameters.decay=3;r.parameters.speed=2.5;let previous=Infinity;for(let i=0;i<170;i++){const f=sampleEffect(r,r.parameters.charge+r.parameters.active+i/60);assert.ok(f.particles.length<=previous,family+' creates particles during decay');previous=f.particles.length;}assert.ok(previous<=1,family+' particles did not expire');}
});
