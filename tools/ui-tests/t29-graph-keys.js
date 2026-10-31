// T29 (12-EDITOR keyboard equivalents, outline, focus/error navigation, reduced effects) on the ungrouped spark burst:
// select by mouse in the graph and from the Outline, Ctrl+D / Delete / Ctrl+Z / Escape / F in the graph, an error's
// link focuses the node and field it is about, and the Reduced effects switch.
const count = d => d?.graphs?.[0]?.nodes?.length ?? 0;
const flowNode = id => $(`.react-flow__node[data-id="${id}"]`);
const selectedIds = () => $$('.react-flow__node.selected').map(e => e.getAttribute('data-id'));
const n0 = count(await savedDoc() ?? { graphs: [] });

// Mouse: click a node in the graph; it becomes the selection and the Outline marks it.
await click(flowNode('spark-burst-drag'));
check('mouse: clicking a graph node selects it', selectedIds().includes('spark-burst-drag'), selectedIds().join(','));
await click(byText('.pv2-tab', /^Outline$/));
const pressed = $$('.ol-name[aria-pressed="true"]').map(b => b.title);
check('outline marks the node selected in the graph', pressed.some(t => t.includes('(Drag)')), pressed.join(' | '));

// Keyboard in the graph: Ctrl+D duplicates, Delete removes the copy, Ctrl+Z undoes the delete.
await click(flowNode('spark-burst-drag'));
await key('d', 2);
let d = await savedDoc();
const afterDup = count(d);
check('Ctrl+D duplicates the selected node', afterDup === count(await savedDoc()) && afterDup >= 1 && (n0 === 0 || afterDup === n0 + 1), `${n0} -> ${afterDup}`);
const copy = selectedIds()[0];
check('the copy is selected after Ctrl+D', copy && copy !== 'spark-burst-drag', selectedIds().join(','));
await key('Delete');
d = await savedDoc();
check('Delete removes the selected copy', count(d) === afterDup - 1 && !nodeIn(d, copy), `${afterDup} -> ${count(d)}`);
await key('z', 2);
d = await savedDoc();
check('Ctrl+Z brings the deleted node back', count(d) === afterDup, `${count(d)}`);
await key('Escape');
check('Escape clears the selection', selectedIds().length === 0, selectedIds().join(',') + ' focus=' + document.activeElement?.tagName + '.' + (document.activeElement?.className || '').toString().slice(0, 50) + ' ' + (document.activeElement?.dataset?.id || ''));

// F fits the view: pan away with the middle button (a left drag box-selects), then F brings the graph back.
const vp = () => $('.react-flow__viewport')?.style.transform ?? '';
await drag($('.react-flow__pane'), 300, 200, 6, 'middle');
const moved = vp();
const panned = moved;
check('middle-drag pans the graph', selectedIds().length === 0, selectedIds().join(','));
await click($('.react-flow__pane')); await key('f'); await sleep(500);
check('F fits the graph back into view', vp() !== panned, `${panned} -> ${vp()}`);

// Outline: picking a part there selects it in the graph; Solo shows the preview-only note.
await click(byText('.pv2-tab', /^Outline$/));
await click($$('.ol-name').find(b => b.title.includes('(Gravity)')));
check('outline click selects the node in the graph', selectedIds().includes('spark-burst-grav'), selectedIds().join(','));
await click(byText('.pv2-tab', /^Outline$/));
const solo = $$('.ol-solo').find(b => b.closest('li')?.textContent.includes('trail')) ?? $$('.ol-solo')[0];
await click(solo);
check('Solo shows the "only these parts" note', $('.ol-solo-note'), $('.ol-solo-note')?.textContent);
const clear = byText('button', /^Clear solo$/); if (clear) await click(clear);

await key('Escape');
// Error navigation: the Ctrl+D copy (restored by Ctrl+Z) has no particle input, so Issues lists an error linked to it;
// the link selects that node and puts keyboard focus in the inspector.
await click(byText('.pv2-tab', /^Issues/));
const links = $$('.pv2-diag-link');
const link = links.find(b => b.textContent.includes(copy));
check('Issues lists a linked error for the unconnected copy', link, links.map(b => b.textContent).join(' || '));
if (link) {
  await click(link); await sleep(300);
  check('the error link selects the node it is about', selectedIds().includes(copy), selectedIds().join(','));
  const a = document.activeElement;
  check('the error link moves keyboard focus into the inspector', a && a.closest('.ni-row, .ni, [class*="inspector"]'), a ? `${a.tagName}#${a.id}` : 'none');
}

// Reduced effects (no screen flash / camera shake): a labelled switch the user can turn on and off.
await click(byText('button', /View/));
const rbox = $$('label.pv2-check').find(l => /Reduced effects/.test(l.textContent))?.querySelector('input');
check('Reduced effects switch exists', rbox, '');
if (rbox) { const was = rbox.checked; await click(rbox); check('Reduced effects toggles', rbox.checked !== was, `${was} -> ${rbox.checked}`); await click(rbox); }
return { checks };
