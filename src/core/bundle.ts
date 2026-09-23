import { validateRecipe } from './recipe.ts';
import { encodeWav, synthesize } from '../audio/synth.ts';
import type { Recipe } from './types.ts';
/** Self-contained JSON package; no engine-specific code or remote assets. */
export function serializeBundle(recipe:Recipe):string {
 const normalized=validateRecipe(recipe);const samples=synthesize(normalized,48000);const wav=new Uint8Array(encodeWav(samples,48000));let binary='';for(let i=0;i<wav.length;i+=8192)binary+=String.fromCharCode(...wav.subarray(i,i+8192));
 return JSON.stringify({format:'vfx-studio-bundle',bundleVersion:1,recipe:normalized,manifest:{coordinates:'right-handed, Y-up',lengthUnit:'meter',timeUnit:'second',generatorVersion:normalized.generatorVersion,simulationHz:60,randomAlgorithm:'mulberry32',engineExport:'not implemented',assets:[{path:'sound.wav',mime:'audio/wav',sampleRate:48000,channels:1,encoding:'base64',data:btoa(binary)}]}},null,2)+'\n';
}
