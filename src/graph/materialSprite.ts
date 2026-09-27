// Material sprite resolution shared by the preview compilers: an imported document texture asset
// (Material.textureAsset, non-empty) wins over the included-library sheet (Material.sprite).
import { BUILTIN_SPRITES } from '../assets/builtinSprites.generated.ts';
import { assetSpriteSheet } from '../assets/importTexture.ts';
import type { SpriteSheet } from '../assets/spriteLibrary.ts';
import type { EffectDocumentV2, ParameterValue } from '../model/types.ts';

/** The sheet to draw, or an error message; `field` names the Material parameter at fault. */
export function materialSheet(doc: Pick<EffectDocumentV2, 'assets'>, sprite: ParameterValue, textureAsset: ParameterValue): { sheet: SpriteSheet } | { error: string; field: 'sprite' | 'textureAsset' } {
  if (typeof textureAsset === 'string' && textureAsset !== '') {
    const s = assetSpriteSheet(doc, textureAsset);
    return typeof s === 'string' ? { error: s, field: 'textureAsset' } : { sheet: s };
  }
  const b = BUILTIN_SPRITES.find(x => x.id === sprite);
  return b ? { sheet: structuredClone(b) as SpriteSheet } : { error: `Material sprite "${String(sprite)}" is not in the included library.`, field: 'sprite' };
}
