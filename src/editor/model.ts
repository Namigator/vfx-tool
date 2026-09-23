import type { Recipe } from '../core/types.ts';
/** One history entry per gesture; camera state stays outside authored history. */
export class RecipeHistory {
 readonly past: Recipe[] = [];
 readonly future: Recipe[] = [];
 private group: string | null = null;
 private recorded = false;
 private readonly limit:number;
 constructor(limit=80){this.limit=limit;}
 begin(key:string):void { if(this.group!==key){this.group=key;this.recorded=false;} }
 end():void {this.group=null;this.recorded=false;}
 record(current:Recipe,next:Recipe):boolean {
  if(JSON.stringify(current)===JSON.stringify(next))return false;
  if(!this.group||!this.recorded){this.past.push(structuredClone(current));if(this.past.length>this.limit)this.past.shift();this.recorded=true;}
  this.future.length=0;return true;
 }
 undo(current:Recipe):Recipe|null {this.end();const r=this.past.pop();if(!r)return null;this.future.push(structuredClone(current));return structuredClone(r);}
 redo(current:Recipe):Recipe|null {this.end();const r=this.future.pop();if(!r)return null;this.past.push(structuredClone(current));return structuredClone(r);}
}
export function commitNumber(draft:string,previous:number,min:number,max:number,integer=false):number {
 if(!draft.trim())return previous;const n=Number(draft);if(!Number.isFinite(n))return previous;
 return Math.max(min,Math.min(max,integer?Math.round(n):n));
}
export interface Playback {time:number;playing:boolean;loop:boolean;rate:number;last:number}
/** Pure transport step. Audio position, when available, is the normal-speed master clock. */
export function advancePlayback(state:Playback,now:number,total:number,audioPosition:number|null=null):{looped:boolean;ended:boolean} {
 const elapsed=state.last?Math.max(0,(now-state.last)/1000):0;state.last=now;
 if(!state.playing)return {looped:false,ended:false};
 state.time=state.rate===1&&audioPosition!==null?audioPosition:state.time+elapsed*state.rate;
 if(state.time>=total){if(state.loop){state.time=0;return {looped:true,ended:false}}state.time=total;state.playing=false;return {looped:false,ended:true}}
 return {looped:false,ended:false};
}
