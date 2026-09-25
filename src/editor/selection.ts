// Pure single-node selection resolution for GraphCanvas (12-EDITOR); no DOM/React dependencies.

// Structural subset of React Flow NodeChange: add changes carry no id, so id is optional and only read after guards.
export type SelectChange = { readonly type: string; readonly id?: string; readonly selected?: boolean };

/**
 * Resolves one React Flow change batch to a single selection intent, independent of change order.
 * Returns the newly selected id, null when the current node is deselected with no replacement,
 * or undefined when the batch does not affect selection.
 */
export function resolveSelection(changes: readonly SelectChange[], current: string | undefined): string | null | undefined {
  let selected: string | undefined;
  let deselectedCurrent = false;
  for (const c of changes) {
    if (c.type !== 'select' || typeof c.id !== 'string') continue;
    if (c.selected) selected = c.id;
    else if (c.id === current) deselectedCurrent = true;
  }
  if (selected !== undefined) return selected === current ? undefined : selected;
  return deselectedCurrent ? null : undefined;
}
