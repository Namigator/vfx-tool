/** Stable display colours from document order; Source and Target keep their familiar colours. */
export function anchorColor(id: string, customIndex: number): string {
  if (id === 'source') return '#6fd48f';
  if (id === 'target') return '#ffa060';
  const hue = (210 + customIndex * 137.508) % 360;
  return `hsl(${hue}, 80%, 68%)`;
}
