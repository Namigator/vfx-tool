import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { EffectFrame, Recipe, Particle } from '../core/types.ts';
const MAX_SEGMENTS=96, MAX_PARTICLES=512;
type StrokeSlot={mesh:LineSegments2;geometry:LineSegmentsGeometry;material:LineMaterial;positions:Float32Array};
type ParticlePool={mesh:THREE.Points;geometry:THREE.BufferGeometry;material:THREE.ShaderMaterial;positions:Float32Array;colors:Float32Array;sizes:Float32Array;alphas:Float32Array};
export class Viewport {
 private scene=new THREE.Scene();private camera=new THREE.PerspectiveCamera(43,1,.1,150);private renderer:THREE.WebGLRenderer;
 private controls:OrbitControls;private composer:EffectComposer;private bloom:UnrealBloomPass;private observer:ResizeObserver;
 private strokes:StrokeSlot[]=[];private rings:StrokeSlot[]=[];private solids:THREE.Mesh[]=[];private particles:ParticlePool[]=[];
 private lights:THREE.PointLight[]=[];private markers:THREE.Mesh[]=[];private glow=true;private background:'dark'|'light'='dark';
 private shard=new THREE.ConeGeometry(1,1,5);private rock=new THREE.IcosahedronGeometry(.7,0);private orb=new THREE.SphereGeometry(.5,16,12);
 private ground:THREE.Mesh;private disposed=false;private color=new THREE.Color();
 constructor(private host:HTMLElement){
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  this.renderer.info.autoReset=false;this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;host.appendChild(this.renderer.domElement);
  this.scene.background=new THREE.Color('#080d16');this.scene.fog=new THREE.FogExp2('#080d16',.034);
  this.camera.position.set(11,8,15);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,1,0);this.controls.enableDamping=true;this.controls.minDistance=5;this.controls.maxDistance=38;this.controls.maxPolarAngle=Math.PI*.49;this.controls.update();
  this.scene.add(new THREE.HemisphereLight('#cbdfff','#304255',2.1));const key=new THREE.DirectionalLight('#d5e6ff',2.8);key.position.set(-3,10,5);this.scene.add(key);
  this.ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshStandardMaterial({color:'#101927',roughness:.7,metalness:.2}));this.ground.rotation.x=-Math.PI/2;this.ground.position.y=-.05;this.scene.add(this.ground);
  const grid=new THREE.GridHelper(50,50,'#344758','#233443');(grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.27;this.scene.add(grid);
  const circle=new THREE.Mesh(new THREE.RingGeometry(7.9,7.92,160),new THREE.MeshBasicMaterial({color:'#375367',transparent:true,opacity:.35,side:THREE.DoubleSide}));circle.rotation.x=-Math.PI/2;circle.position.y=.006;this.scene.add(circle);
  for(let i=0;i<2;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.055,12,8),new THREE.MeshBasicMaterial({color:'#96aabc'}));this.markers.push(m);this.scene.add(m)}
  for(let i=0;i<4;i++){const l=new THREE.PointLight('#83cfff',0,9,2);this.lights.push(l);this.scene.add(l)}
  this.particles=[this.createParticles(false),this.createParticles(true)];
  this.composer=new EffectComposer(this.renderer);this.composer.addPass(new RenderPass(this.scene,this.camera));this.bloom=new UnrealBloomPass(new THREE.Vector2(800,600),.8,.55,.7);this.composer.addPass(this.bloom);this.composer.addPass(new OutputPass());
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();
 }
 private createParticles(mist:boolean):ParticlePool{
  const positions=new Float32Array(MAX_PARTICLES*3),colors=new Float32Array(MAX_PARTICLES*3),sizes=new Float32Array(MAX_PARTICLES),alphas=new Float32Array(MAX_PARTICLES);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('aColor',new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('aAlpha',new THREE.BufferAttribute(alphas,1).setUsage(THREE.DynamicDrawUsage));
  const material=new THREE.ShaderMaterial({uniforms:{uScale:{value:500},uMist:{value:mist?1:0}},vertexShader:`attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uScale; varying vec3 vColor; varying float vAlpha; void main(){vColor=aColor;vAlpha=aAlpha;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(aSize*uScale/max(.1,-p.z),1.,200.);}`,fragmentShader:`uniform float uMist;varying vec3 vColor;varying float vAlpha;void main(){vec2 q=gl_PointCoord-.5;float r=length(q)*2.;if(r>1.)discard;float alpha=mix(pow(1.-r,2.2),pow(1.-r*r,2.),uMist);gl_FragColor=vec4(vColor,alpha*vAlpha);}`,transparent:true,depthWrite:false,blending:mist?THREE.NormalBlending:THREE.AdditiveBlending,toneMapped:false});
  const mesh=new THREE.Points(geometry,material);mesh.frustumCulled=false;this.scene.add(mesh);return {mesh,geometry,material,positions,colors,sizes,alphas};
 }
 private slot(pool:StrokeSlot[],index:number):StrokeSlot{
  if(pool[index])return pool[index];const positions=new Float32Array(MAX_SEGMENTS*6),geometry=new LineSegmentsGeometry();geometry.setPositions(positions);
  const material=new LineMaterial({color:0xffffff,linewidth:.03,worldUnits:true,transparent:true,opacity:1,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  material.resolution.set(this.host.clientWidth,this.host.clientHeight);const mesh=new LineSegments2(geometry,material);mesh.frustumCulled=false;this.scene.add(mesh);const slot={mesh,geometry,material,positions};pool.push(slot);return slot;
 }
 private drawStroke(slot:StrokeSlot,points:readonly (readonly number[])[],width:number,color:string,opacity:number,intensity:number){
  const n=Math.min(MAX_SEGMENTS,points.length-1),attr=slot.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute;const a=attr.data.array;
  for(let i=0;i<n;i++){const p=points[i],q=points[i+1];for(let j=0;j<3;j++){a[i*6+j]=p[j];a[i*6+3+j]=q[j]}}attr.data.needsUpdate=true;slot.geometry.instanceCount=n;slot.material.color.set(color).multiplyScalar(.65+intensity*.95);slot.material.linewidth=width;slot.material.opacity=opacity;slot.mesh.visible=n>0&&opacity>.001;
 }
 private drawParticles(items:Particle[],intensity:number){
  for(let k=0;k<2;k++){const pool=this.particles[k];let n=0;for(const p of items){if((p.kind==='mist')!==(k===1)||n>=MAX_PARTICLES)continue;pool.positions.set(p.position,n*3);this.color.set(p.color).multiplyScalar(k===1?1:.9+intensity*.65);pool.colors.set([this.color.r,this.color.g,this.color.b],n*3);pool.sizes[n]=p.size*(k===1?4:5);pool.alphas[n]=p.opacity;n++}for(const name of ['position','aColor','aSize','aAlpha'])pool.geometry.getAttribute(name).needsUpdate=true;pool.geometry.setDrawRange(0,n);pool.mesh.visible=n>0;}
 }
 update(frame:EffectFrame,recipe:Recipe){if(this.disposed)return;const intensity=recipe.parameters.intensity;
  this.markers[0].position.fromArray(recipe.source);this.markers[1].position.fromArray(recipe.target);
  const strokeCount=Math.min(frame.strokes.length,128);for(let i=0;i<strokeCount;i++){const s=frame.strokes[i];this.drawStroke(this.slot(this.strokes,i),s.points,s.width,s.color,s.opacity,intensity)}for(let i=strokeCount;i<this.strokes.length;i++)this.strokes[i].mesh.visible=false;
  const ringCount=Math.min(frame.rings.length,16);for(let i=0;i<ringCount;i++){const r=frame.rings[i];const points:number[][]=[];for(let j=0;j<=64;j++){const a=j/64*Math.PI*2;points.push([r.center[0]+Math.cos(a)*r.radius,Math.max(.025,r.center[1]-.05),r.center[2]+Math.sin(a)*r.radius])}this.drawStroke(this.slot(this.rings,i),points,r.width,r.color,r.opacity,intensity)}for(let i=ringCount;i<this.rings.length;i++)this.rings[i].mesh.visible=false;
  this.drawParticles(frame.particles,intensity);
  const count=Math.min(frame.solids.length,128);for(let i=0;i<count;i++){const s=frame.solids[i];if(!this.solids[i]){const mesh=new THREE.Mesh(this.rock,new THREE.MeshStandardMaterial({roughness:.38,metalness:.12,transparent:true,flatShading:true}));this.solids.push(mesh);this.scene.add(mesh)}const m=this.solids[i];m.geometry=s.shape==='shard'?this.shard:s.shape==='orb'?this.orb:this.rock;m.position.fromArray(s.position);m.rotation.set(...s.rotation);m.scale.fromArray(s.scale);const mat=m.material as THREE.MeshStandardMaterial;mat.color.set(s.color);mat.emissive.set(s.color).multiplyScalar(s.shape==='shard'?.3:.04);mat.opacity=s.opacity;mat.depthWrite=s.opacity>.8;m.visible=s.opacity>.001;}for(let i=count;i<this.solids.length;i++)this.solids[i].visible=false;
  for(let i=0;i<this.lights.length;i++){const f=frame.lights[i],l=this.lights[i];l.intensity=f?f.intensity*14:0;if(f){l.position.fromArray(f.position);l.color.set(f.color)}}
  this.controls.update();this.renderer.info.reset();if(this.glow)this.composer.render();else this.renderer.render(this.scene,this.camera);
 }
 resize(){if(this.disposed)return;const w=this.host.clientWidth||800,h=this.host.clientHeight||500;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);this.composer.setSize(w,h);for(const p of [...this.strokes,...this.rings])p.material.resolution.set(w,h);for(const p of this.particles)p.material.uniforms.uScale.value=h*this.renderer.getPixelRatio()/Math.tan(THREE.MathUtils.degToRad(43/2));}
 setBackground(mode:'dark'|'light'){this.background=mode;const c=mode==='dark'?'#080d16':'#798a9e';this.scene.background=new THREE.Color(c);(this.scene.fog as THREE.FogExp2).color.set(c);(this.ground.material as THREE.MeshStandardMaterial).color.set(mode==='dark'?'#101927':'#627186')}
 setGlow(enabled:boolean){this.glow=enabled}
 resetCamera(){this.camera.position.set(11,8,15);this.controls.target.set(0,1,0);this.controls.update()}
 stats(){const s=this.renderer.info;return {drawCalls:s.render.calls,triangles:s.render.triangles,geometries:s.memory.geometries,textures:s.memory.textures}}
 dispose(){if(this.disposed)return;this.disposed=true;this.observer.disconnect();this.controls.dispose();for(const pass of this.composer.passes)pass.dispose();this.composer.dispose();const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();this.scene.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry)geometries.add(m.geometry);if(m.material)for(const mat of Array.isArray(m.material)?m.material:[m.material])materials.add(mat)});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();this.shard.dispose();this.rock.dispose();this.orb.dispose();this.renderer.dispose();this.renderer.domElement.remove()}
}
