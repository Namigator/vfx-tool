const mask=(1n<<32n)-1n,u=x=>x&mask;
const fnv=bytes=>{let h=2166136261n;for(const b of bytes)h=u((h^BigInt(b))*16777619n);return Number(h)};
const mb=seed=>{const a=u(BigInt(seed)+0x6D2B79F5n);let t=u((a^(a>>15n))*(a|1n));t=u(t^u(t+u((t^(t>>7n))*(t|61n))));return Number(u(t^(t>>14n)))};
const unicode=[[0xc3,0xa9],[0xe2,0x82,0xac],[0xf0,0x9f,0x98,0x80]].map(bytes=>({bytes,hash:fnv(bytes)}));
const tuples=[0,42].map(seed=>{const text=`[2,${seed},"stream_a","",0,"velocityX",0]`; const hash=fnv([...text].map(c=>c.charCodeAt(0))); return {text,hash,uint32:mb(hash),sample:mb(hash)/2**32}});
console.log(JSON.stringify({method:'Manager independent BigInt modulo arithmetic; hand-listed UTF-8 bytes',unicode,mulberry:[0,42].map(seed=>({seed,uint32:mb(seed),sample:mb(seed)/2**32})),tuples},null,2));
