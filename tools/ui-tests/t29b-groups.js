// fixture: grouped.json
// T29 groups: Enter opens the selected component group, the breadcrumb shows where you are, Escape goes back up.
const flowNode = id => $(`.react-flow__node[data-id="${id}"]`);
const group = flowNode('spark-burst');
check('the grouped spark burst is one node on the top graph', group, $$('.react-flow__node').map(e => e.getAttribute('data-id')).join(','));
await click(group);
await key('Enter'); await sleep(500);
const crumbs = () => $$('.gc-trail button, .gc-trail strong').map(e => e.textContent.trim());
check('Enter opens the group (breadcrumb shows it)', crumbs().length >= 2, crumbs().join(' > '));
check('inside the group its nodes are shown', flowNode('spark-burst-em'), $$('.react-flow__node').map(e => e.dataset.id).join(','));
await click($('.react-flow__pane')); await key('Escape'); await sleep(200); await key('Escape'); await sleep(500);
check('Escape goes back up to the top graph', flowNode(group.getAttribute('data-id')), crumbs().join(' > '));
return { checks };
