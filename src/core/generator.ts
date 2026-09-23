import type { EffectFrame, Recipe, Vec3 } from './types.ts';

/** Stable uint32 PRNG. No global random state is used by the sampler. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(x) ? x : a));
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(mul(a, 1 - t), mul(b, t));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (v: Vec3): Vec3 => mul(v, 1 / (Math.hypot(...v) || 1));
const point = (p: Vec3): Vec3 => [clamp(p[0],-10000,10000),clamp(p[1],-10000,10000),clamp(p[2],-10000,10000)];
function hashFamily(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0),16777619);
  return h >>> 0;
}

/** Renderer-independent world-space geometry. Sampling never advances state. */
export function sampleEffect(recipe: Recipe, time: number): EffectFrame {
  const t = Math.round(clamp(time,0,86400)*60)/60;
  const p = recipe.parameters;
  const charge = clamp(p.charge,0,30), active = clamp(p.active,0.02,30), decay = clamp(p.decay,0,30);
  const total = charge+active+decay;
  const f: EffectFrame = {strokes:[],particles:[],solids:[],rings:[],lights:[],phase:'ready',time:t};
  if (t <= 0) return f;
  if (time >= total || t >= total) { f.phase='finished'; return f; }
  f.phase = t < charge ? 'charging' : t < charge+active ? 'active' : 'decay';
  const source = point(recipe.source), target = point(recipe.target);
  const scale=clamp(p.scale,0.05,20), intensity=clamp(p.intensity,0,10);
  const count=Math.round(clamp(p.count,0,400)), spread=clamp(p.spread,0,10);
  const speed=clamp(p.speed,0.05,15), turbulence=clamp(p.turbulence,0,5);
  const width=clamp(p.width,0.002,2)*scale;
  const color=p.color, secondary=p.secondaryColor;
  const seed=(recipe.seed>>>0)^hashFamily(recipe.family);
  const rng=(id:number,stream=0)=>mulberry32(seed ^ Math.imul(id+1,0x9e3779b1) ^ Math.imul(stream+1,0x85ebca6b));
  const axis=unit(add(target,mul(source,-1)));
  const direction:Vec3=Math.hypot(...axis)>0 ? axis : [1,0,0];
  const side=unit(cross(direction,Math.abs(direction[1])>0.9 ? [1,0,0] : [0,1,0]));
  const up=unit(cross(side,direction));
  const offset=(base:Vec3,x:number,y:number)=>add(base,add(mul(side,x),mul(up,y)));
  const power = Math.min(1,intensity);
  const particle=(position:Vec3,size:number,opacity:number,kind:'spark'|'mist'|'orb'='spark',c=color)=>{
    if(opacity>1e-8 && size>0) f.particles.push({position,size,color:c,opacity:clamp(opacity*power,0,1),kind});
  };
  const stroke=(points:Vec3[],w=width,opacity=1,c=color)=>f.strokes.push({points,width:w,color:c,opacity:clamp(opacity*power,0,1)});
  const ring=(center:Vec3,radius:number,opacity:number,c=color)=>f.rings.push({center,radius:Math.max(0.001,radius),width:width*0.65,color:c,opacity:clamp(opacity*power,0,1)});
  if (f.phase==='charging') {
    const q=t/charge;
    particle(source,scale*(0.06+0.24*q),q,'orb',secondary);
    for(let i=0;i<Math.min(count,36);i++) {
      const r=rng(i), angle=r()*TAU+t*speed*2;
      const radius=scale*(0.12+(1-q)*(0.3+r()*0.8))*spread;
      particle(offset(source,Math.cos(angle)*radius,Math.sin(angle)*radius),scale*0.025,q*0.7,'spark');
    }
    f.lights.push({position:source,color,intensity:q*intensity*2});
    return f;
  }
  const elapsed=t-charge, u=clamp(elapsed/active,0,1);
  const fade=f.phase==='decay' ? clamp(1-(elapsed-active)/(decay || 1),0,1) : 1;
  const motion=elapsed*speed;
  // Existing particles finish their lifetime after emission stops at the active boundary.
  const ageAt=(phase:number,rate:number)=>Math.min(1,elapsed<=active?(elapsed*speed*rate+phase)%1:(active*speed*rate+phase)%1+(elapsed-active)*speed*rate);
  f.lights.push({position:lerp(source,target,Math.min(1,u*1.5)),color,intensity:fade*intensity*3});
  switch(recipe.family) {
    case 'lightning': {
      const tick=Math.floor(motion*24), r=rng(tick,90);
      const points:Vec3[]=[];
      for(let j=0;j<=42;j++) {
        const q=j/42, envelope=j===0 || j===42 ? 0 : Math.sin(q*Math.PI);
        points.push(offset(lerp(source,target,q),(r()-0.5)*0.65*spread*scale*envelope*turbulence,(r()-0.5)*0.65*spread*scale*envelope*turbulence+envelope*0.3*scale));
      }
      stroke(points,width,fade); stroke(points,width*0.22,fade,secondary);
      for(let i=0;i<Math.round(clamp(p.branches,0,64));i++) {
        const b=rng(i,tick+100), start=points[3+Math.floor(b()*34)];
        const end=offset(add(start,mul(direction,scale*(0.3+b()*1.1))), (b()-0.5)*scale*spread*2,(b()-0.5)*scale*spread*2);
        const branch:Vec3[]=[];
        for(let j=0;j<=8;j++) branch.push(offset(lerp(start,end,j/8),(b()-0.5)*scale*0.16*turbulence,(b()-0.5)*scale*0.16*turbulence));
        branch[0]=[...start];branch[8]=[...end];
        stroke(branch,width*0.4,fade*0.75);
      }
      particle(target,scale*0.22,fade,'orb',secondary);
      for(let i=0;i<count;i++) {
        const b=rng(i,12), age=ageAt(b(),1), angle=b()*TAU;
        particle(add(target,[Math.cos(angle)*age*scale*spread,age*(1-age)*scale*2,Math.sin(angle)*age*scale*spread]),scale*0.025,(1-age)*fade);
      }
      break;
    }
    case 'fire': {
      for(let i=0;i<count;i++) {
        const r=rng(i), age=ageAt(r(),0.65), a=r()*TAU;
        const radius=scale*spread*(0.08+age*0.45)*r();
        const pos=offset(lerp(source,target,age),Math.cos(a+motion*turbulence)*radius,Math.sin(a+motion*turbulence)*radius);
        pos[1]+=scale*age*age*1.3;
        particle(pos,scale*(0.12+0.24*age)*(0.6+r()*0.4),Math.sin(age*Math.PI)*fade,i%5===0?'spark':'mist',i%3===0?secondary:color);
      }
      particle(source,scale*0.24,fade,'orb',secondary);
      break;
    }
    case 'ice': {
      for(let i=0;i<Math.min(count,100);i++) {
        const r=rng(i), a=r()*TAU, radial=Math.sqrt(r())*scale*spread;
        const height=scale*(0.3+r()*1.7)*Math.min(1,elapsed*5*speed);
        f.solids.push({position:add(target,[Math.cos(a)*radial,height*0.35,Math.sin(a)*radial]),rotation:[(r()-0.5)*0.8,a,(r()-0.5)*0.8],scale:[scale*(0.07+r()*0.12),height,scale*0.1],color:i%3?color:secondary,opacity:fade*power,shape:'shard'});
      }
      ring(target,scale*(0.2+u*spread),fade*0.6);
      for(let i=0;i<Math.min(count,80);i++) {
        const r=rng(i,3), a=r()*TAU;
        particle(add(target,[Math.cos(a)*scale*spread*u,r()*scale*(0.2+u*2),Math.sin(a)*scale*spread*u]),scale*0.035,fade*0.8,'spark',secondary);
      }
      break;
    }
    case 'water': {
      for(let k=0;k<3;k++) {
        const pts:Vec3[]=[];
        for(let j=0;j<=40;j++) {
          const q=j/40, pos=lerp(source,target,q);
          pos[1]+=Math.sin(q*Math.PI)*scale*(1.1+spread*0.3);
          pts.push(offset(pos,Math.sin(q*14-motion*5+k*2)*scale*0.08*turbulence,Math.cos(q*11-motion*4+k)*scale*0.08));
        }
        stroke(pts,width*(k===0?2:0.6),fade*(k===0?0.8:0.45),k?secondary:color);
      }
      for(let i=0;i<count;i++) {
        const r=rng(i), age=ageAt(r(),0.5), a=r()*TAU;
        particle(add(target,[Math.cos(a)*age*scale*spread,Math.sin(age*Math.PI)*scale*(0.3+r()),Math.sin(a)*age*scale*spread]),scale*(0.035+r()*0.035),fade*(1-age),'orb');
      }
      for(let i=0;i<3;i++) {const q=ageAt(i/3,0.6);ring(target,scale*(0.2+q*spread*1.8),fade*(1-q));}
      break;
    }
    case 'wind': {
      for(let k=0;k<Math.min(10,Math.max(2,Math.round(count/12)));k++) {
        const pts:Vec3[]=[], r=rng(k), start=r()*TAU;
        for(let j=0;j<=48;j++) {
          const q=j/48, a=q*TAU*2-motion*4+start, radius=scale*spread*Math.sin(q*Math.PI)*(0.3+k*0.06);
          pts.push(offset(lerp(source,target,q),Math.cos(a)*radius,Math.sin(a)*radius));
        }
        stroke(pts,width*0.5,fade*0.6,k%2?secondary:color);
      }
      for(let i=0;i<count;i++){const r=rng(i,7),q=ageAt(r(),0.5),a=q*TAU*2-motion*4;if(q>=1)continue;particle(offset(lerp(source,target,q),Math.cos(a)*scale*spread*0.5,Math.sin(a)*scale*spread*0.5),scale*0.022,fade*0.6);}
      break;
    }
    case 'earth': {
      for(let i=0;i<Math.min(count,90);i++) {
        const r=rng(i), a=r()*TAU, flight=Math.min(1,elapsed*speed*0.8), reach=scale*spread*(0.3+r())*flight;
        const size=scale*(0.09+r()*0.25), h=Math.max(0,flight*(1-flight)*scale*(2+r()*5));
        f.solids.push({position:add(target,[Math.cos(a)*reach,h+size*0.5,Math.sin(a)*reach]),rotation:[motion*r(),a,motion*r()],scale:[size,size*(0.6+r()),size],color:i%3?color:secondary,opacity:fade*power,shape:'rock'});
        particle(add(target,[Math.cos(a)*reach,h*0.3,Math.sin(a)*reach]),size*1.5,fade*0.25,'mist',secondary);
      }
      ring(target,scale*(0.2+u*spread*1.5),fade*0.5);
      break;
    }
    case 'light': {
      particle(target,scale*(0.18+0.22*Math.sin(u*Math.PI)),fade,'orb',secondary);
      for(let i=0;i<Math.min(count,64);i++) {
        const r=rng(i), a=r()*TAU, z=r()*2-1, radial=Math.sqrt(1-z*z), dir:Vec3=[Math.cos(a)*radial,z,Math.sin(a)*radial];
        const length=scale*spread*(0.4+r()*1.7)*(0.5+u);
        stroke([add(target,mul(dir,scale*0.15)),add(target,mul(dir,length))],width*0.45,fade*(0.4+r()*0.6),i%3?color:secondary);
      }
      ring(target,scale*(0.2+u*spread*2),fade);
      break;
    }
    case 'shadow': {
      for(let k=0;k<Math.min(16,Math.max(3,Math.round(count/8)));k++) {
        const r=rng(k), start=r()*TAU, pts:Vec3[]=[];
        for(let j=0;j<=36;j++){const q=j/36,a=start+q*TAU*1.5+motion*2,radius=scale*spread*(1-q)*1.2;pts.push(add(target,[Math.cos(a)*radius,scale*(1-q)*0.9,Math.sin(a)*radius]));}
        stroke(pts,width*(1+k%3)*0.5,fade*0.7,k%4?color:secondary);
      }
      for(let i=0;i<count;i++){const r=rng(i,2),q=ageAt(r(),0.35),a=r()*TAU+q*TAU*1.5;particle(add(target,[Math.cos(a)*(1-q)*scale*spread,(1-q)*scale,Math.sin(a)*(1-q)*scale*spread]),scale*0.12,fade*Math.sin(q*Math.PI)*0.6,'mist');}
      particle(target,scale*0.28,fade,'orb',secondary);
      break;
    }
    case 'poison': {
      for(let i=0;i<count;i++) {
        const r=rng(i), age=ageAt(r(),0.25), a=r()*TAU, radius=scale*spread*(0.15+age*0.6)*r();
        particle(add(target,[Math.cos(a+motion*turbulence*0.2)*radius,age*scale*2.4,Math.sin(a+motion*turbulence*0.2)*radius]),scale*(0.06+age*0.2),fade*Math.sin(age*Math.PI)*0.7,i%3?'mist':'orb',i%4?color:secondary);
      }
      ring(target,scale*spread*0.7,fade*0.5);
      break;
    }
    case 'energy': {
      const travel=clamp(elapsed*speed/(active*0.72),0,1), head=lerp(source,target,travel);
      particle(head,scale*0.23,fade,'orb',secondary);
      const pts:Vec3[]=[];
      for(let j=0;j<=32;j++){const q=Math.max(0,travel-j/32*0.5),pos=lerp(source,target,q);pts.push(offset(pos,Math.sin(q*30-motion*8)*scale*0.05*turbulence,Math.cos(q*30-motion*8)*scale*0.05*turbulence));}
      stroke(pts,width*2,fade);stroke(pts,width*0.35,fade,secondary);
      for(let i=0;i<count;i++) {
        const r=rng(i), a=r()*TAU, behind=r()*0.4, q=Math.max(0,travel-behind), radius=behind*scale*spread;
        particle(offset(lerp(source,target,q),Math.cos(a+motion)*radius,Math.sin(a+motion)*radius),scale*0.035,fade*(1-behind),'spark',i%2?color:secondary);
      }
      if(travel>=1) ring(target,scale*(0.2+Math.max(0,elapsed-active*0.72/speed)*speed*spread*2),fade);
      break;
    }
  }
  return f;
}
