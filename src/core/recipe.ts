import { FAMILIES, type Family, type Recipe, type Parameters, type ParamSpec } from './types.ts';
export interface FamilyInfo { title:string; subtitle:string; color:string; secondary:string; count:number; active:number; charge:number; decay:number; description:string }
export const FAMILY_INFO:Record<Family,FamilyInfo>={
 lightning:{title:'Lightning',subtitle:'Branching arc',color:'#66baff',secondary:'#eefaff',count:100,active:.65,charge:.39,decay:1.2,description:'A charged filament, branching discharge, and scattered impact sparks.'},
 fire:{title:'Fire',subtitle:'Flame jet',color:'#ff681d',secondary:'#ffe58c',count:180,active:1.5,charge:.3,decay:1.3,description:'A directed flame plume, rising embers, and a smoky afterglow.'},
 ice:{title:'Ice',subtitle:'Crystal eruption',color:'#7de5ff',secondary:'#e5fcff',count:28,active:1.2,charge:.5,decay:1.4,description:'Growing crystal shards fracture into a cold cloud of frost.'},
 water:{title:'Water',subtitle:'Arc & splash',color:'#278fff',secondary:'#a1efff',count:130,active:1.5,charge:.35,decay:1.2,description:'A liquid arc breaks into droplets and expanding ground ripples.'},
 wind:{title:'Wind',subtitle:'Spiral gust',color:'#afeee3',secondary:'#f0fffa',count:80,active:1.8,charge:.3,decay:1,description:'Helical air ribbons sweep through a field of drifting streaks.'},
 earth:{title:'Earth',subtitle:'Stone upheaval',color:'#bd8b57',secondary:'#f4d3a0',count:24,active:1.1,charge:.6,decay:1.8,description:'Faceted rocks rise from the ground in a cloud of settling dust.'},
 light:{title:'Light',subtitle:'Radiant pulse',color:'#ffe9a2',secondary:'#ffffff',count:48,active:1.1,charge:.65,decay:1.3,description:'A focused core opens into clean rays and a luminous shock ring.'},
 shadow:{title:'Shadow',subtitle:'Inward vortex',color:'#7f4cbd',secondary:'#c099ef',count:150,active:1.8,charge:.4,decay:1.2,description:'Dark wisps spiral inward, gathering around a collapsing core.'},
 poison:{title:'Poison',subtitle:'Caustic bloom',color:'#a8e638',secondary:'#e5ff9b',count:130,active:1.8,charge:.3,decay:1.7,description:'A creeping cloud carries suspended bubbles and falling droplets.'},
 energy:{title:'Energy',subtitle:'Charged projectile',color:'#dd6bff',secondary:'#ffd6ff',count:110,active:1.5,charge:.6,decay:1.3,description:'A charged orb leaves a twisting trail before a radial impact.'}
};
export const PARAM_SPECS:ParamSpec[]=[
 {key:'scale',label:'Scale',min:.3,max:2,step:.05,unit:'×',restart:true},
 {key:'intensity',label:'Emission',min:.2,max:2,step:.05,unit:'×',restart:false},
 {key:'count',label:'Particle count',min:8,max:300,step:1,unit:'',restart:true},
 {key:'spread',label:'Spread',min:.1,max:2.5,step:.05,unit:'m',restart:true},
 {key:'speed',label:'Speed',min:.3,max:2.5,step:.05,unit:'×',restart:true},
 {key:'turbulence',label:'Turbulence',min:0,max:2,step:.05,unit:'×',restart:true},
 {key:'branches',label:'Branches',min:0,max:24,step:1,unit:'',restart:true},
 {key:'width',label:'Core width',min:.01,max:.15,step:.005,unit:'m',restart:false},
 {key:'charge',label:'Charge',min:.1,max:1.5,step:.05,unit:'s',restart:true},
 {key:'active',label:'Active',min:.2,max:3,step:.05,unit:'s',restart:true},
 {key:'decay',label:'Decay',min:.2,max:3,step:.05,unit:'s',restart:true},
 {key:'volume',label:'Volume',min:0,max:1,step:.05,unit:'',restart:false},
 {key:'pitch',label:'Pitch',min:.5,max:2,step:.05,unit:'×',restart:true}
];
export function createRecipe(family:Family='lightning'):Recipe {const f=FAMILY_INFO[family];return {schemaVersion:1,generatorVersion:'1.0.0',id:`${family}-default`,name:f.title+' / Original',family,seed:42,source:[-4,1.5,0],target:[4,.12,0],parameters:{scale:1,intensity:1,count:f.count,spread:1,speed:1,turbulence:.7,branches:12,width:.045,charge:f.charge,active:f.active,decay:f.decay,color:f.color,secondaryColor:f.secondary,volume:.55,pitch:1}};}
export const FAMILY_COUNT_CAP:Partial<Record<Family,number>>={ice:100,earth:90,light:64};
const fail=(field:string,reason:string):never=>{throw new Error(`${field}: ${reason}`)};
function record(value:unknown,path:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail(path,'expected an object');return value as Record<string,unknown>}
export function validateRecipe(value:unknown):Recipe {
 const o=record(value,'Recipe');if(o.schemaVersion!==1)fail('schemaVersion','only version 1 is supported');if(o.generatorVersion!=='1.0.0')fail('generatorVersion','unsupported generator');
 if(!FAMILIES.includes(o.family as Family))fail('family','unknown element');
 if(typeof o.name!=='string'||o.name.trim().length<1||o.name.length>80)fail('name','use 1–80 characters');
 if(typeof o.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(o.id))fail('id','invalid identifier');
 if(typeof o.seed!=='number'||!Number.isInteger(o.seed)||o.seed<0||o.seed>4294967295)fail('seed','use an integer between 0 and 4294967295');
 const anchor=(key:'source'|'target')=>{const a=o[key];if(!Array.isArray(a)||a.length!==3||a.some(x=>typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>12))fail(key,'expected three finite coordinates between -12 and 12 meters');if((a as number[])[1]<0||(a as number[])[1]>8)fail(key+'.y','height must be 0–8 meters');return [...(a as number[])] as [number,number,number]};
 const p=record(o.parameters,'parameters');const params:Record<string,number|string>={};
 for(const s of PARAM_SPECS){const v=p[s.key];if(typeof v!=='number'||!Number.isFinite(v)||v<s.min||v>s.max)fail('parameters.'+s.key,`expected ${s.min}–${s.max}`);if((s.key==='count'||s.key==='branches')&&!Number.isInteger(v))fail('parameters.'+s.key,'expected an integer');params[s.key]=v as number}
 for(const key of ['color','secondaryColor']){if(typeof p[key]!=='string'||!/^#[\da-f]{6}$/i.test(p[key] as string))fail('parameters.'+key,'expected a six-digit hex color');params[key]=p[key] as string}
 if((params.count as number)>(FAMILY_COUNT_CAP[o.family as Family]||300))fail('parameters.count','exceeds this element capacity');
 return {schemaVersion:1,generatorVersion:'1.0.0',id:o.id as string,name:o.name as string,family:o.family as Family,seed:o.seed as number,source:anchor('source'),target:anchor('target'),parameters:params as unknown as Parameters};
}
export function parseRecipe(text:string):Recipe {if(text.length>2000000)throw Error('Recipe exceeds 2 MB');let value:unknown;try{value=JSON.parse(text)}catch{throw Error('This file is not valid JSON')}if(value&&typeof value==='object'&&(value as Record<string,unknown>).format==='vfx-studio-bundle'){const bundle=value as Record<string,unknown>;if(bundle.bundleVersion!==1)throw Error('Unsupported bundle version');return validateRecipe(bundle.recipe)}return validateRecipe(value)}
export function serializeRecipe(recipe:Recipe):string{return JSON.stringify(validateRecipe(recipe),null,2)+'\n'}
export function visibleSpecs(family:Family):ParamSpec[]{return PARAM_SPECS.filter(s=>!['charge','active','decay','volume','pitch'].includes(s.key)&&(family==='lightning'||s.key!=='branches')&&(!['ice','earth','light','wind','shadow'].includes(family)||s.key!=='turbulence')&&(family!=='light'||s.key!=='speed')&&(['lightning','water','wind','energy'].includes(family)||s.key!=='width')).map(s=>({...s,max:s.key==='count'?(FAMILY_COUNT_CAP[family]||s.max):s.max,label:s.key==='count'&&['ice','earth'].includes(family)?'Shard / rock count':s.label}));}
