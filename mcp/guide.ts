// vfx_guide: authoring know-how distilled from the ten element families built with this tool (A-05 finding:
// fresh agents had every capability but not the recipes — e.g. a continuous flame jet needs many small, faint,
// stretched additive tongues, not a few big bright ones).
// Plain text, one topic per entry, no source code. These short topics are the fallback; the full guide (docs/ai-guide)
// is served by guideText below.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUIDE: Record<string, string> = {
  basics: `BASICS
- Graph: Schedule (when) -> Emitter (how many/where) -> InitialProperties (size/colour/spin) -> forces (Gravity, Drag, NoiseForce, Attract, Vortex, GroundCollision) -> BillboardRenderer/MeshRenderer/ParticleTrail + Material -> EffectOutput.visual. Paths (LinePath, BezierPath, JaggedPath, HelixPath, RingPath...) -> RibbonRenderer draw beams, bolts, rings.
- Time is in ticks (60/s). A Schedule "window" opens [startTicks, startTicks+durationTicks); continuous emitters use Rate + a window and Burst 0; bursts use Burst + Trigger (Schedule start, PathFollower arrival, ParticleEvents...).
- Event-relative timing: connect an event to Schedule.trigger so the window starts relative to it (impacts after an arrival).
- vfx_compile after every batch: read warnings (tail cut off, event ticks, lights). vfx_render_frames: always look at the images; it also reports lit/bright coverage and warns on glow flooding.
- Tip: build one layer at a time and render it alone before stacking the next.`,

  glow: `GLOW, BRIGHTNESS AND BLENDING
- Additive sprites ADD: 200 overlapping sprites at opacity 1 become a blown-out blob and the bloom floods the frame. Dense additive layers need LOW per-sprite opacity (0.05-0.2) and emission 0-0.5; only a small hot core may use emission 1-2.
- Glow is per effect on EffectOutput: glowStrength (0.8), glowRadius (0.45; 0.2-0.3 = tighter), glowThreshold (1; raise to 1.3-1.6 for dense fire), glowLimit (3; 1.5-2 for dense additive stacks). If vfx_render_frames warns "glow flooding", lower per-sprite opacity/emission first, then glowLimit.
- blend "normal" for smoke, dust, water, dark or opaque stuff; "additive" for fire tongues, sparks, glows, energy.
- Colour: keep fire orange-yellow (#FFB040..#FFE9B0); reds (#C02000) only at the very end of life and faint. Saturated red at full opacity reads as "petals".`,

  fire: `FIRE / FLAMETHROWER JET (continuous flame body) - proven against the standalone reference
- Flame BODY: two emitters (sprites flame-tongue-a / flame-tongue-b), each: cone, coneAngle ~0.105 (6 deg half-angle), radius 0.02, rate ~210/s (420 total), speed 8.5-11 m/s, life 0.4-0.75 s, Burst 0, rateOverWindow [0:0.35, 0.04:1, 0.92:1, 1:0], Aim = Target.
- InitialProperties size 0.22-0.30 (the tongue fills only half its square cell, so sprites must be about twice the flame width you want).
- Forces: Drag 0.18, NoiseForce vector amplitude ~3 frequency 0.55, Gravity [0,0.9,0] (the far end billows up).
- BillboardRenderer: alignment velocity, stretchRatio ~1.6, pivot 0.38, flipbookMode overLife; sizeOverLife [0:1, 0.7:3.7, 1:2.2]; opacityOverLife [0:0, 0.07:1, 0.55:1, 1:0]; colorOverLife white -> #FFE0A0 -> #FFA050 -> #C8501E -> #5A1E0A (the flame COOLS as it ages - this is what gives the white root, orange body and dark red tips).
- Material: blend NORMAL (not additive), opacity ~0.62, dissolve 0.6 from 0.5 of life. Normal blend keeps the body readable and never floods the glow.
- Faint additive accent: a second BillboardRenderer on the same particles (flame-tongue-a, additive, opacity ~0.05, tint #FFF2D0), visible only while young (opacityOverLife [0:0, 0.05:1, 0.45:0]).
- Hot core: cone 3 deg (0.052), rate ~130/s, speed 10-13, life 0.23-0.43 s, size 0.15-0.18, additive, opacity ~0.13, tint #FFF6E0, stretchRatio ~1.9.
- Smoke and embers are born WHERE TONGUES DIE: ParticleEvents(death) on each tongue chain -> Emitter with Burst 1, useEventPosition, inheritVelocity 0.35-0.45. Smoke probability ~0.08 (smoke-puff, normal, #6A625A, opacity peak ~0.32, size 0.35-0.5 growing x2.4, Gravity up 1.6, life 1-1.9 s). Event-born particles INHERIT the jet speed: always add Drag (~1.2-1.6) to smoke and embers or they fly out of frame; check with vfx_sample_particles if something seems missing. Embers probability ~0.1 (spark-streak additive + a SpriteUnlit ParticleTrail, Gravity down ~3.5, life 0.5-1.2 s).
- Glow: the default EffectOutput glow works with these values (core opacity ~0.13, accent ~0.05); only touch glow settings if vfx_render_frames warns about flooding.
- Light: two PointLights along the jet (OffsetAnchor 1.2 m and 3 m from Source, 0.3 m up), #FF7A28, intensity ~16, range ~3.5, flicker 0.25.
- Ignition: SpriteRenderer soft-glow variant 1 at the muzzle (11 ticks) + CameraImpulse (translation 0.03). Nozzle: PropMesh cylinder at Source aimed at Target (pivot end), leg PropMesh Direction [0,-1,0] pivot start; a dark lit Material (#3A2E26, roughness ~0.55, metalness ~0.4) so it reads as metal, not a bright grey bar.
- Decay / billows elsewhere: sprite fire-puff (a fire blob that cools and tears apart).`,

  smoke: `SMOKE / DUST / CLOUDS
- smoke-puff flipbook (overLife), blend normal, tint greys/browns, randomFrameStart + random rotation + slow spin (angular velocity +-0.4).
- Few, large-growing particles: size 0.2-0.5 growing x2.5-4; opacity peak 0.25-0.6 early then fade; Drag 0.6-1.6 so they slow; Gravity up 0.1-1.4; NoiseForce curl low amplitude for curling.
- Material groundFade 0.2-0.3 so puffs touching the floor fade softly instead of being cut. Dark smoke on dark floors is invisible - lighten it or render on background "light" to check.`,

  sparks: `SPARKS / EMBERS / DEBRIS
- spark-streak sprite, additive, alignment velocity, stretchRatio 3-6, pivot 0.7-0.8, size 0.015-0.04, emission 0.8-1.5.
- Burst on an event (impact) or a low rate (20-60/s) during a window; Gravity down for sparks, up for embers; Drag 1-2; GroundCollision bounce restitution 0.3 for impacts.
- colorOverLife white -> orange -> dark red with alpha 0 at the end. ParticleTrail adds tapered streaks (history 0.08-0.15 s); it needs a separate SpriteUnlit Material (additive, tinted).
- Stones/debris: MeshRenderer rock-a/b/c, orientation tumble, lit, rough Material (roughness 0.85). For real stone add surfaceDetail 0.75, detailScale 5, colorVariation 0.7, reflection 0.3 and a mid-brown tint (#7A6654); without them rocks read as flat plastic.
- Ice: lit crystal/shard meshes, tint #4E94BE, roughness 0.08, reflection 0.6, surfaceDetail 0.3, colorVariation 0.45, rim 0.25 (#CFF4FF), opacity 0.88. Keep reflection and rim low or it glows like neon. Cold air: a slow rate emitter of smoke-puff (opacity about 0.16) under the shards for as long as they stand.
- Water: never a solid blue ribbon. RibbonRenderer + Material liquid 0.85, pale tint (#D8EEF8), blend normal; droplets = sprite droplet, blend normal, near-white tint. Additive dots read as sparks, not water.
- Bubbles/gas: sprite bubble (thin rim, clear middle), blend normal, opacity about 0.75; ripple-ring reads as flat circles.
- Ground rings, scorch marks and light pools under a Target: OffsetAnchor from node-target with dropToGround true and offset [0, 0.02, 0]. Never a separate fixed document anchor: it stays behind when Target moves.`,

  beams: `BEAMS, BOLTS, RINGS (ribbons)
- LinePath/BezierPath between Source and Target; JaggedPath + BranchPath for lightning; HelixPath for swirling wind/energy; RingPath for shockwaves.
- RevealPath with a Time/ScalarMath fraction animates a bolt shooting out. RibbonRenderer width 0.02-0.08 with endFade; layer a thin bright core over a wider faint sheath.
- Textured ribbons (Material SpriteTextured electric-arc / smoke-puff) with uvScroll and uvDistort for flowing energy/wind.`,

  projectile: `PROJECTILES AND TIMING
- BezierPath from Source to Target -> PathFollower (Travel ticks, or Speed m/s). Its Anchor output moves SpriteRenderer cores, emitters (trails of sparks), PointLights and MotionTrail.
- Its Arrival event triggers impact Schedules (Schedule.trigger), bursts (Emitter.trigger) and flashes, so the impact always lands when the projectile does.
- Charge-up before launch: Attract pulls motes inward to an anchor; a SpriteRenderer core grows with sizeOverWindow.`,

  props: `PROPS AND MESHES
- PropMesh: one static mesh (cylinder, box, cone, orb, shard, rock-*, crystal*, or an imported GLB) at an anchor, pointing at Aim (another anchor) or along Direction. Width = size, Length = along the pointing direction. pivot start: the mesh begins at the anchor and extends along the pointing direction (legs, posts); pivot end: it ends at the anchor, body behind (nozzles, barrels); center: centred.
- OffsetAnchor moves an anchor by a fixed offset (a floor point under the target, a point above a hand...).
- Lit meshes need light: a PointLight near them; Material roughness/metalness shape the look; rim adds an edge glow.
- MeshRenderer mesh "plane" is a flat 1 m card (+Y forward) for decals and flakes; set Material faceMode "double" to see both sides.`,

  materials: `MATERIALS AND TEMPLATES
- Material.template sets fixed rules on the same fields: SpriteUnlit (soft disc), SpriteTextured (library or imported sprite), RibbonUnlit (plain strips), MeshLit (meshes lit whatever the renderer says), SurfaceTranslucent (normal blend, liquid ribbons, some reflection, optional refraction on meshes), DarkVolumeSprite (normal-blend textured smoke, emission forced to 0 so glow never lifts it).
- hueShift (-180..180 degrees) rotates every colour the material draws; each component gets an automatic "Colour" knob (degrees, or pass a "#RRGGBB" to vfx_set_control) that keeps the light-to-dark look.
- recolorFrom/recolorTo (Material, PointLight) recolour one part fully (hue, saturation, brightness): recolorFrom is the part's representative colour, recolorTo what it becomes. Components publish one "<Part> colour" knob per part (Flame, Embers, Smoke & dust, Flash & rings, Light...).
- Flipbooks: BillboardRenderer flipbookMode overLife/fps/first; flipbookLoop false holds the last frame in fps mode; flipbookCrossfade blends into the next cell (smoother slow flipbooks).
- Dissolve (billboards): dissolve amount, dissolveStart, dissolveEdge + dissolveEdgeColor for a burning rim. noiseAsset (an imported texture with role noise) replaces the included dissolve pattern.
- Lit meshes: reflection, surfaceDetail + detailScale, colorVariation, rim; normalAsset (an imported texture with role normal) adds real relief; refraction bends what is behind (preview enhancement).
- Included sprites (vfx_describe_node_type Material lists them): flame tongues, fire-puff, smoke-puff, foam, soft-glow, spark-streak, electric-arc, droplet, bubble, ripple-ring, dissolve-noise, lightning-charge (16-frame gathering crackle), wisp (thin/broad threads), dark-wisp (16-frame tendril), star-ray (star, ray burst, thin ring, cross flare), gradient (linear, radial, band, diagonal).`,

  values: `CURVES, GRADIENTS AND OVER-LIFE
- Curve and Gradient value nodes feed curve/gradient parameters (one curve can drive several renderers).
- OverLife sits in a particle chain: size/opacity/colour/spin-speed over life for every renderer downstream, unless that renderer sets its own.
- RingRenderer: a closed ring at an anchor with a radius curve over its window (shockwaves) - simpler than RingPath + RibbonRenderer.
- Emitter shape "path": births spread along the connected paths by arc length (sparks along a bolt, mist along a stream).
- A parent knob bound to a Group's exposed control drives the group's PublicParameter nodes.`,

  workflow: `WORKFLOW TOOLS
- Components: vfx_list_components, then vfx_add_component (group true), or vfx_new_document component="<id>" to open a preset as a new effect. startOn "node.port" starts a component on an event (vfx_list_events lists them).
- Imported assets: vfx_import_texture role color|mask|normal|noise (materialId applies it), vfx_import_mesh, then vfx_add_asset_component inserts a ready-made component that uses the asset.
- Editing: vfx_duplicate_nodes (preservePattern keeps the same random pattern), vfx_copy_nodes / vfx_paste_nodes, vfx_remove_node reconnect=true joins the neighbours, vfx_group_nodes, vfx_set_control (a longer Travel grows the effect duration).
- Timeline: vfx_list_timeline shows each component's active tick span, its Start at knob and its length knob; move a component with vfx_set_control on its Start at, stretch it with its length control.
- Keyframes: a number knob can change over the effect - the ◇ button in the editor's Controls panel adds a key at the playhead; vfx_set_control_keys sets {tick, value} keys (values in between are linear, held before the first and after the last; empty keys stops animating). Timing knobs (Start at, Burn time, Travel...) cannot be animated.
- Looking: vfx_render_frames / vfx_contact_sheet accept orbit {yaw, pitch, distance}, camera, solo [node ids] and background "light". Look at the images before claiming anything.`,
};

// ---------------------------------------------------------------- docs/ai-guide lookup
const GUIDE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'ai-guide');
const MAX_WHOLE_REFERENCE = 30_000;

/** Chapters in reading order with a one-line summary for the index. */
export const CHAPTERS: Array<[string, string]> = [
  ['readme', 'Guide index, reading order and the five rules.'],
  ['concepts', 'The mental model: documents, node graph, time (schedules, windows, events), anchors, components and knobs, keyframes, materials, glow.'],
  ['workflow', 'The build, compile, render, look, adjust loop with exact tool calls and a worked example.'],
  ['look', 'What makes effects read well (blending, colour, scale, motion, timing, layering) and the common wrong looks with causes.'],
  ['troubleshooting', 'Every diagnostic code, frequent messages and an "it looks wrong" table.'],
  ['export', '.vfx.json, .vfxpack and Roblox export: aiming API, textures, what changes.'],
  ['editor', 'Where everything is in the editor, with the matching MCP tool for each action.'],
];
export const REFERENCES: Array<[string, string]> = [
  ['nodes', 'Every node type: ports, parameters with units, ranges, defaults (look up one with { node }).'],
  ['components', 'Every included component and its knobs (look up one with { component }).'],
  ['sprites', 'The included sprite library: grids, flipbook/variant sets, usage.'],
  ['mcp-tools', 'Every MCP tool and its arguments.'],
  ['diagnostics', 'Every error code, what it means and where it is raised.'],
  ['limits', 'Hard limits and budgets (particles, duration, lights, paths, import sizes).'],
];
const SHORT_SUMMARIES: Record<string, string> = {
  basics: 'graph shape and timing in five lines', glow: 'additive blending, bloom settings', fire: 'the proven flamethrower build, number by number',
  smoke: 'smoke, dust, clouds', sparks: 'sparks, embers, debris, stone, ice, water', beams: 'beams, bolts, rings (ribbons)', projectile: 'projectiles and event timing',
  props: 'PropMesh and meshes', materials: 'Material templates, hue shift, recolour, dissolve, lit meshes', values: 'curves, gradients, over-life',
  tools: 'tool workflow cheat sheet (components, assets, editing, timeline, keyframes)',
};

const readGuide = (rel: string): string | undefined => {
  const p = join(GUIDE_DIR, ...rel.split('/'));
  return existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : undefined;
};
const recipeNames = (): string[] => {
  const d = join(GUIDE_DIR, 'recipes');
  return existsSync(d) ? readdirSync(d).filter(n => n.endsWith('.md')).map(n => n.slice(0, -3)).sort() : [];
};
const firstLine = (text: string): string => {
  const lines = text.split('\n');
  const h1 = lines.findIndex(l => /^# /.test(l));
  for (const l of lines.slice(h1 + 1)) if (l.trim() && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('<!--')) return l.trim().slice(0, 160);
  return '';
};

interface Heading { level: number; title: string; start: number; end: number }
function headings(text: string): Heading[] {
  const lines = text.split('\n');
  const out: Heading[] = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^```/.test(l)) fence = !fence;
    const m = !fence && l.match(/^(#{1,4}) (.+?)\s*$/);
    if (m) out.push({ level: m[1].length, title: m[2], start: i, end: lines.length });
  });
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) if (out[j].level <= out[i].level) { out[i].end = out[j].start; break; }
  return out;
}
const slugOf = (t: string) => t.toLowerCase().replace(/^\d+\.\s*/, '').replace(/[^a-z0-9 _-]/g, '').trim().replace(/ +/g, '-');
const slice = (text: string, h: Heading) => text.split('\n').slice(h.start, h.end).join('\n').trim();

/** Sections of `text` whose heading matches (exact slug/title/number first, then prefix, then substring). */
function findSection(text: string, query: string, minLevel = 2, maxLevel = 3): Heading[] {
  const q = query.trim().toLowerCase().replace(/^#+\s*/, '');
  const qs = slugOf(q);
  const hs = headings(text).filter(h => h.level >= minLevel && h.level <= maxLevel);
  const num = (h: Heading) => h.title.match(/^(\d+)\./)?.[1];
  const exact = hs.filter(h => h.title.toLowerCase() === q || slugOf(h.title) === qs || num(h) === q.replace(/\.$/, ''));
  if (exact.length) return exact;
  const prefix = hs.filter(h => slugOf(h.title).startsWith(qs));
  if (prefix.length) return prefix;
  return hs.filter(h => slugOf(h.title).includes(qs));
}

function outline(text: string, maxLevel: number): string {
  return headings(text).filter(h => h.level >= 2 && h.level <= maxLevel).map(h => `${'  '.repeat(h.level - 2)}- ${h.title}`).join('\n');
}

function indexText(): string {
  const rec = recipeNames();
  const lines = ['VFX Studio guide. Call vfx_guide with { topic } for a chapter, { topic, section } for one section, { node } or { component } for one reference entry.', '', 'Chapters (docs/ai-guide):'];
  for (const [n, sum] of CHAPTERS) lines.push(`- ${n}: ${sum}`);
  lines.push('', 'Recipes per family (topic "recipes/<family>"):');
  if (rec.length) for (const r of rec) { const t = readGuide(`recipes/${r}.md`); lines.push(`- recipes/${r}${t ? `: ${firstLine(t)}` : ''}`); }
  else lines.push('- (not written yet)');
  lines.push('', 'Reference (generated from the code; topic "reference/<name>"):');
  for (const [n, sum] of REFERENCES) lines.push(`- reference/${n}: ${sum}`);
  lines.push('', 'Short topics (older quick notes with exact numbers):');
  for (const k of Object.keys(GUIDE)) { const name = k === 'workflow' ? 'tools' : k; lines.push(`- ${name}: ${SHORT_SUMMARIES[name] ?? ''}`); }
  lines.push('', 'Start with "readme", then "concepts" and "workflow". Look at rendered frames (vfx_render_frames) before judging an effect.');
  return lines.join('\n');
}

function entry(file: string, label: string, key: string): string {
  const text = readGuide(`reference/${file}`);
  if (!text) return `The reference file docs/ai-guide/reference/${file} is missing. Run \`npm run guide\`.`;
  const hs = headings(text).filter(h => h.level === 3);
  const k = key.trim().toLowerCase();
  const hit = hs.find(h => h.title.toLowerCase() === k) ?? hs.find(h => slugOf(h.title) === slugOf(k));
  if (hit) return slice(text, hit);
  const names = hs.map(h => h.title);
  const near = names.filter(n => n.toLowerCase().includes(k) || k.includes(n.toLowerCase()));
  return `No ${label} "${key}". ${near.length ? `Did you mean: ${near.slice(0, 12).join(', ')}? ` : ''}All ${label}s: ${names.join(', ')}.`;
}

function chapterText(rel: string, section: string | undefined, isRef: boolean): string {
  const text = readGuide(`${rel === 'readme' ? 'README' : rel}.md`);
  if (!text) return `No chapter "${rel}" (docs/ai-guide/${rel}.md does not exist${rel.startsWith('recipes/') ? ' yet; recipes are still being written' : ''}). Call vfx_guide with no arguments for the index.`;
  if (section) {
    const hs = findSection(text, section);
    if (!hs.length) return `No section "${section}" in ${rel}. Sections:\n${outline(text, isRef ? 3 : 2)}`;
    return hs.slice(0, 6).map(h => slice(text, h)).join('\n\n');
  }
  if (isRef && text.length > MAX_WHOLE_REFERENCE) {
    const per = rel.endsWith('nodes') ? ', or { node: "<type>" }' : rel.endsWith('components') ? ', or { component: "<id>" }' : '';
    return `${rel} is large (${Math.round(text.length / 1000)} kB). Ask for one part with { topic: "${rel}", section: "<heading>" }${per}. Sections:\n${outline(text, per ? 3 : 2)}`;
  }
  return text;
}

export interface GuideQuery { topic?: string; section?: string; node?: string; component?: string }

/** Serves docs/ai-guide (index, chapters, sections, node/component entries) with the old short topics as fallback. Never throws. */
export function guideText(arg?: string | GuideQuery): string {
  const q: GuideQuery = typeof arg === 'string' ? { topic: arg } : arg ?? {};
  try {
    if (q.node) return entry('nodes.md', 'node type', q.node);
    if (q.component) return entry('components.md', 'component', q.component);
    if (!q.topic) return indexText();
    const raw = q.topic.trim().toLowerCase().replace(/\.md$/, '').replace(/^docs\/ai-guide\//, '').replace(/\\/g, '/');
    if (raw === 'index') return indexText();
    if (raw === 'tools') return GUIDE.workflow;
    if (raw !== 'workflow' && GUIDE[raw]) return GUIDE[raw] + (q.section ? '\n\n(Short topics have no sections; see the chapters in the index.)' : '');
    if (raw === 'recipes') {
      const r = recipeNames();
      return r.length ? `Recipe chapters: ${r.map(n => `recipes/${n}`).join(', ')}.` : 'Recipes are not written yet. Use the short topics (fire, smoke, sparks, beams, projectile, props) and reference/components.';
    }
    if (CHAPTERS.some(([n]) => n === raw)) return chapterText(raw, q.section, false);
    if (raw.startsWith('recipes/')) return chapterText(raw, q.section, false);
    const ref = raw.replace(/^reference\//, '');
    if (REFERENCES.some(([n]) => n === ref)) return chapterText(`reference/${ref}`, q.section, true);
    const names = [...CHAPTERS.map(c => c[0]), ...recipeNames().map(n => `recipes/${n}`), ...REFERENCES.map(r => `reference/${r[0]}`), ...Object.keys(GUIDE).filter(k => k !== 'workflow'), 'tools'];
    return `Unknown topic "${q.topic}". Topics: ${names.join(', ')}. Call vfx_guide with no arguments for the index.`;
  } catch (e) {
    return `The guide could not be read (${e instanceof Error ? e.message : String(e)}). Call vfx_guide with no arguments for the index.`;
  }
}
