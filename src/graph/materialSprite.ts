// Material sprite resolution shared by the preview compilers: an imported document texture asset
// (Material.textureAsset, non-empty) wins over the included-library sheet (Material.sprite).
import { BUILTIN_SPRITES } from '../assets/builtinSprites.generated.ts';
import { assetSpriteSheet } from '../assets/importTexture.ts';
import type { SpriteSheet } from '../assets/spriteLibrary.ts';
import type { EffectDocumentV2, ParameterValue } from '../model/types.ts';

/**
 * 09 material templates. They are reusable settings, not effect-family switches:
 * SpriteUnlit (soft disc) · SpriteTextured (library/imported sprite) · RibbonUnlit (untextured strips) ·
 * MeshLit (PBR meshes: lit even when the renderer is not) · SurfaceTranslucent (normal blend, liquid shading on ribbons,
 * restrained reflection, optional refraction on meshes; textured when a sprite/texture is chosen) ·
 * DarkVolumeSprite (normal-alpha textured smoke: emission forced to 0 so bloom never lifts it; edge tint = rim colour).
 */
export const MATERIAL_TEMPLATE_IDS = ['SpriteUnlit', 'SpriteTextured', 'RibbonUnlit', 'MeshLit', 'SurfaceTranslucent', 'DarkVolumeSprite'] as const;

/** Parameter value after the template's fixed rules (only these fields are template-controlled). */
export function templateParam(template: unknown, id: string, value: ParameterValue): ParameterValue {
  if (template === 'DarkVolumeSprite') { if (id === 'blend') return 'normal'; if (id === 'emission') return 0; }
  if (template === 'SurfaceTranslucent') {
    if (id === 'blend') return 'normal';
    if (id === 'liquid' && typeof value === 'number') return Math.max(value, 0.85);
    if (id === 'reflection' && typeof value === 'number') return Math.max(value, 0.4);
  }
  return value;
}

/** Whether the material draws a sprite/texture (vs. the procedural soft shape). */
export function isTexturedTemplate(template: unknown, stored: Readonly<Record<string, unknown>>): boolean {
  if (template === 'SpriteTextured' || template === 'DarkVolumeSprite') return true;
  if (template === 'SurfaceTranslucent') return Object.hasOwn(stored, 'sprite') || (typeof stored.textureAsset === 'string' && stored.textureAsset !== '');
  return false;
}

/** MeshLit and SurfaceTranslucent light their meshes whatever the renderer's Lit switch says. */
export const templateLitsMeshes = (template: unknown) => template === 'MeshLit' || template === 'SurfaceTranslucent';

/** The sheet to draw, or an error message; `field` names the Material parameter at fault. */
export function materialSheet(doc: Pick<EffectDocumentV2, 'assets'>, sprite: ParameterValue, textureAsset: ParameterValue): { sheet: SpriteSheet } | { error: string; field: 'sprite' | 'textureAsset' } {
  if (typeof textureAsset === 'string' && textureAsset !== '') {
    const s = assetSpriteSheet(doc, textureAsset);
    return typeof s === 'string' ? { error: s, field: 'textureAsset' } : { sheet: s };
  }
  const b = BUILTIN_SPRITES.find(x => x.id === sprite);
  return b ? { sheet: structuredClone(b) as SpriteSheet } : { error: `Material sprite "${String(sprite)}" is not in the included library.`, field: 'sprite' };
}
