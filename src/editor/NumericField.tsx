import { useEffect, useRef, useState } from 'react';
import { commitNumber } from './model.ts';
export function NumericField({label,value,min,max,step,onCommit}:{label:string;value:number;min:number;max:number;step:number;onCommit:(n:number)=>void}) {
 const format=(n:number)=>String(Number(n.toFixed(5)));
 const [draft,setDraft]=useState(format(value));const focused=useRef(false),lastValue=useRef(value);
 useEffect(()=>{if(!focused.current||lastValue.current!==value)setDraft(format(value));lastValue.current=value;},[value]);
 const commit=()=>{const next=commitNumber(draft,value,min,max,step===1);setDraft(format(next));if(next!==value)onCommit(next)};
 return <input aria-label={label} type="number" min={min} max={max} step={step} value={draft} onFocus={()=>{focused.current=true}} onChange={e=>setDraft(e.target.value)} onBlur={()=>{focused.current=false;commit()}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit()}if(e.key==='Escape'){e.preventDefault();setDraft(format(value))}}}/>;
}
