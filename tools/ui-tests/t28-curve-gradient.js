// T28 (12-EDITOR curve/gradient editors): edit "Size over life" and "Colour over life" of the spark burst's
// BillboardRenderer with the mouse and the keyboard in the running editor; every change is read back from the saved
// document. Also: an out-of-range key is refused, and a knob-driven field is read-only until unbound.
const NODE = 'spark-burst-bb';
await selectNode('(BillboardRenderer)');
const curve = $('[aria-label="Size over life curve"]');
check('size curve editor shown', curve, $$('.ce[role=group]').map(e => e.getAttribute('aria-label')).join(', '));
const keysOf = d => nodeIn(d, NODE)?.params?.sizeOverLife?.keys ?? [];

// Keyboard: type a value into the key table.
await typeInto($('[aria-label="Key 1 value"]', curve), '0.5');
let d = await savedDoc();
check('keyboard: key 1 value typed + Enter is saved', keysOf(d)[0]?.y === 0.5, JSON.stringify(keysOf(d)));

// Add key (mouse on the button) puts a third key in the widest gap.
await click(byText('button', /^Add key$/, curve));
d = await savedDoc();
check('Add key adds a middle key at x=0.5', keysOf(d).length === 3 && keysOf(d)[1].x === 0.5, JSON.stringify(keysOf(d)));

// Mouse: drag the middle key up; its value rises and its position stays between its neighbours.
const before = keysOf(d)[1];
await drag($$('.ce-key', curve)[1], 25, -30);
d = await savedDoc();
const after = keysOf(d)[1];
check('mouse: dragging the middle key up raises its value', after && after.y > before.y + 0.05, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
check('mouse: dragged key stays inside its neighbours', after && after.x > 0 && after.x < 1, JSON.stringify(after));

// Invalid point: a key position outside the 0..1 domain is refused and the saved curve is unchanged.
const keep = JSON.stringify(keysOf(d));
await typeInto($('[aria-label="Key 2 position"]', curve), '1.7');
d = await savedDoc();
check('invalid: key position 1.7 is refused (curve unchanged)', JSON.stringify(keysOf(d)) === keep, JSON.stringify(keysOf(d)));
check('invalid: the editor shows the saved keys again', Number($('[aria-label="Key 2 position"]', curve)?.value) === keysOf(d)[1].x, $('[aria-label="Key 2 position"]', curve)?.value);

// Interpolation by keyboard: focus the select and pick "hold".
const sel = $('select[aria-label="Size over life interpolation"]');
await click(sel); await key('Escape');
sel.focus(); await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
d = await savedDoc();
check('keyboard: interpolation changed to hold', nodeIn(d, NODE)?.params?.sizeOverLife?.interpolation === 'hold', nodeIn(d, NODE)?.params?.sizeOverLife?.interpolation);

// Delete the middle key.
await click($('[aria-label="Delete key 2"]', curve));
d = await savedDoc();
check('Delete key removes the middle key', keysOf(d).length === 2, JSON.stringify(keysOf(d)));

// Gradient: add a stop, set its alpha by keyboard, change a colour.
const grad = $('[aria-label="Colour over life gradient"]');
const stopsOf = d => nodeIn(d, NODE)?.params?.colorOverLife?.stops ?? [];
const n0 = stopsOf(await savedDoc()).length;
await click(byText('button', /^Add colour stop$/, grad));
d = await savedDoc();
check('gradient: Add colour stop adds one', stopsOf(d).length === n0 + 1, JSON.stringify(stopsOf(d)));
await typeInto($('[aria-label="Stop 2 alpha"]', grad), '0.25');
d = await savedDoc();
check('gradient: stop 2 alpha typed is saved', stopsOf(d)[1]?.color?.alpha === 0.25, JSON.stringify(stopsOf(d)[1]));
await typeInto($('[aria-label="Stop 2 position"]', grad), '1.5');
d = await savedDoc();
check('gradient: stop position 1.5 is refused', stopsOf(d)[1]?.position < 1, JSON.stringify(stopsOf(d).map(s => s.position)));
check('gradient: the refused field shows the kept position', Number($('[aria-label="Stop 2 position"]', grad)?.value) === stopsOf(d)[1]?.position, $('[aria-label="Stop 2 position"]', grad)?.value);

// Driven control: the spark count is driven by the "Sparks per burst" knob, so its field is read-only until unbound.
await selectNode('(Emitter)');
const drivenNote = byText('.ni-driven', /Driven by public control/);
check('driven: knob-bound field says it is driven', drivenNote, $$('.ni-driven').map(e => e.textContent).join(' | '));
const unbind = drivenNote && byText('button', /^Unbind$/, drivenNote);
if (unbind) { await click(unbind); await sleep(300); }
check('driven: Unbind makes the field editable', unbind && !byText('.ni-driven', /Sparks per burst/), $$('.ni-driven').map(e => e.textContent).join(' | '));
return { checks };
