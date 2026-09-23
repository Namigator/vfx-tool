import test from 'node:test';
import assert from 'node:assert/strict';
import { EffectAudio } from '../src/audio/synth.ts';
import { createRecipe } from '../src/core/recipe.ts';
class FakeNode {
 buffer:{duration:number}|null=null;onended:(()=>void)|null=null;disconnected=false;stops:number[]=[];starts:number[][]=[];
 connect(){} disconnect(){this.disconnected=true}start(...args:number[]){this.starts.push(args)}stop(time:number){this.stops.push(time)}
}
class FakeGain {
 disconnected=false;ramps:number[][]=[];
 gain={value:1,cancelScheduledValues:(_t:number)=>{},setValueAtTime:(v:number,_t:number)=>{this.gain.value=v},linearRampToValueAtTime:(v:number,t:number)=>{this.ramps.push([v,t])}};
 connect(){}disconnect(){this.disconnected=true}
}
class FakeContext {
 static instances:FakeContext[]=[];
 currentTime=10;sampleRate=8000;state='suspended';destination={};sources:FakeNode[]=[];gains:FakeGain[]=[];buffers=0;
 constructor(){FakeContext.instances.push(this)}
 async resume(){this.state='running'}async close(){this.state='closed'}
 createBuffer(_channels:number,length:number,rate:number){this.buffers++;return {duration:length/rate,getChannelData:()=>new Float32Array(length)}}
 createBufferSource(){const n=new FakeNode();this.sources.push(n);return n}createGain(){const g=new FakeGain();this.gains.push(g);return g}
}
test('audio clock, cache reuse, source replacement and disposal with a fake Web Audio context',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');Object.defineProperty(globalThis,'AudioContext',{value:FakeContext,configurable:true});
 try{
  const player=new EffectAudio(),r=createRecipe();assert.equal(player.position,null);await player.unlock();const c=FakeContext.instances.at(-1)!;
  player.play(r,.4);assert.deepEqual(c.sources[0].starts,[[0,.4]]);c.currentTime+=.3;assert.ok(Math.abs(player.position!-.7)<1e-10);
  player.play(r,.2);assert.equal(c.buffers,1);assert.equal(c.sources[0].stops.length,1);c.sources[0].onended?.();assert.ok(c.sources[0].disconnected&&c.gains[0].disconnected);assert.equal(player.position,.2,'old source cannot clear replacement');
  player.stop();assert.equal(player.position,null);assert.equal(c.gains[1].ramps.at(-1)![0],0);c.sources[1].onended?.();assert.ok(c.sources[1].disconnected&&c.gains[1].disconnected);
  player.play({...r,seed:r.seed+1});assert.equal(c.buffers,2);player.dispose();assert.equal(c.state,'closed');assert.equal(player.state,'locked');assert.equal(player.position,null);
  await player.unlock();assert.equal(FakeContext.instances.length,2);player.dispose();
 }finally{if(previous)Object.defineProperty(globalThis,'AudioContext',previous);else Reflect.deleteProperty(globalThis,'AudioContext')}
});
