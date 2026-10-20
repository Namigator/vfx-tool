// Small builder for MCP recipe files (mcp/examples/*.steps.json) used by the tools/make-*-recipe.mjs generators.
// recipe(docId) returns step helpers plus two composite layers: ribbon() and envelope().
export function recipe(DOC) {
  const S = [];
  const add = (type, id, params = {}) => { S.push(['vfx_add_node', { docId: DOC, type, id, params }]); return id; };
  const wire = (from, to) => S.push(['vfx_connect', { docId: DOC, from, to }]);
  const out = id => wire(`${id}.visual`, 'node-output.visual');
  const curve = (keys, domain = 'normalized') => ({ domain, interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
  const col = srgb => ({ srgb, alpha: 1 });

  /** Additive ribbon on `paths`. Opacity: fixed, `opacityFrom` (a normalized value) or `drive` x driveScale (a unitless value). */
  function ribbon(id, paths, window, { color, width, opacity = 1, emission = 0, endFade = 0.06, drive, driveScale = 1, widthOverPath, opacityFrom, orientation }) {
    add('Material', `${id}mat`, { template: 'RibbonUnlit', blend: 'additive', tint: col(color), emission, opacity });
    add('RibbonRenderer', id, { width, endFade, ...(widthOverPath ? { widthOverPath } : {}), ...(orientation ? { orientation } : {}) });
    wire(paths, `${id}.paths`); wire(`${id}mat.material`, `${id}.material`); wire(window, `${id}.window`); out(id);
    if (opacityFrom) wire(opacityFrom, `${id}mat.opacity`);
    else if (drive) {
      add('ScalarMath', `${id}lvl`, { operation: 'multiply', b: driveScale, inputUnit: 'none', unit: 'normalized' });
      wire(drive, `${id}lvl.a`); wire(`${id}lvl.value`, `${id}mat.opacity`);
    }
  }
  /** exp(-k·t)·flicker over a window; returns the value output (unitless). k = 0 gives a steady flicker. */
  function envelope(id, window, k, flickerHz, flickerMin = 0.7) {
    add('Time', `${id}clk`); wire(window, `${id}clk.window`);
    add('ScalarMath', `${id}dec`, { operation: 'multiply', b: -k, inputUnit: 'second', unit: 'none' }); wire(`${id}clk.localSeconds`, `${id}dec.a`);
    add('ScalarMath', `${id}exp`, { operation: 'exp', unit: 'none' }); wire(`${id}dec.value`, `${id}exp.a`);
    add('Oscillator', `${id}flk`, { waveform: 'sine', frequency: flickerHz, phase: 0.6, min: flickerMin, max: 1, unit: 'none' });
    add('ScalarMath', `${id}env`, { operation: 'multiply', inputUnit: 'none', unit: 'none' });
    wire(`${id}exp.value`, `${id}env.a`); wire(`${id}flk.value`, `${id}env.b`);
    return `${id}env.value`;
  }
  return { S, add, wire, out, curve, col, ribbon, envelope };
}
