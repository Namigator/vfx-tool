import { createRoot } from 'react-dom/client';

const host = document.getElementById('root')!;
host.textContent = 'Loading workspace…';

// The graph editor is the only editor (the old one was retired before release; its effects open through
// "Import old effect"). ?workspace=v2 links from earlier builds still land here.
async function mountWorkspace() {
  const { default: Workspace } = await import('./PreviewV2.tsx');
  createRoot(host).render(<Workspace />);
}

void mountWorkspace().catch(error => {
  host.textContent = `The workspace could not load: ${error instanceof Error ? error.message : String(error)}`;
});
