import { createRoot } from 'react-dom/client';

const host = document.getElementById('root')!;
host.textContent = 'Loading workspace…';
const useGraphPreview = new URLSearchParams(window.location.search).get('workspace') === 'v2';

async function mountWorkspace() {
  // Load exactly one workspace and its styles; v1 remains the default route.
  const { default: Workspace } = useGraphPreview
    ? await import('./PreviewV2.tsx')
    : await import('./App.tsx');
  if (!useGraphPreview) await import('./style.css');
  createRoot(host).render(<Workspace />);
}

void mountWorkspace().catch(error => {
  host.textContent = `The workspace could not load: ${error instanceof Error ? error.message : String(error)}`;
});
