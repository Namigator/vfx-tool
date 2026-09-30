// Writes work/review/manifest.json for review.html from the component list (main family effects first).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { COMPONENT_TEMPLATES } from '../src/graph/components.ts';
const first = ['lightning-strike', 'flamethrower', 'fire-jet', 'ice-eruption', 'water-stream', 'wind-gust', 'earth-upheaval', 'light-pulse', 'shadow-collapse', 'poison-caustic', 'energy-bolt'];
const order = [...first, ...COMPONENT_TEMPLATES.map(c => c.id).filter(id => !first.includes(id))];
const items = order.map(id => COMPONENT_TEMPLATES.find(c => c.id === id)!).map(c => ({ id: c.id, label: c.label, description: c.description, sheet: `work/mcp/frames/rv-${c.id}-sheet.png` }));
const missing = items.filter(i => !existsSync(i.sheet)).map(i => i.id);
mkdirSync('work/review', { recursive: true });
writeFileSync('work/review/manifest.json', JSON.stringify(items.filter(i => existsSync(i.sheet)), null, 1));
console.log(`${items.length - missing.length} sheets; missing: ${missing.join(', ') || 'none'}`);
