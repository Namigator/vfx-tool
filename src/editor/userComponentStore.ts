// Browser store of saved user components (graph/userComponents.ts): IndexedDB via openProjectStorage, shared by
// every editor view through a tiny subscription so a save shows up in Add component at once.
import { useEffect, useState } from 'react';
import { openProjectStorage } from '../model/assetStore.ts';
import { USER_COMPONENTS_KEY, type UserComponent } from '../graph/userComponents.ts';

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };
let store: Store | null = null;
let list: UserComponent[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<(l: UserComponent[]) => void>();
const publish = () => { for (const f of listeners) f(list); };
let lastError = '';

function load(): Promise<void> {
  loading ??= openProjectStorage([USER_COMPONENTS_KEY], m => { lastError = m; }).then(s => {
    store = s ?? (typeof localStorage === 'undefined' ? null : localStorage);
    try { const v = JSON.parse(store?.getItem(USER_COMPONENTS_KEY) ?? '[]'); list = Array.isArray(v) ? v : []; } catch { list = []; }
    publish();
  });
  return loading;
}

const persist = () => { try { store?.setItem(USER_COMPONENTS_KEY, JSON.stringify(list)); } catch (e) { lastError = e instanceof Error ? e.message : String(e); } publish(); };

export function saveUserComponent(c: UserComponent): void { list = [c, ...list.filter(x => x.name !== c.name)]; persist(); }
export function removeUserComponent(id: string): void { list = list.filter(x => x.id !== id); persist(); }
export function userComponentError(): string { return lastError; }
/** Text of every saved component (blocks), for asset cleanup. */
export function userComponentsText(): string { return JSON.stringify(list); }

export function useUserComponents(): UserComponent[] {
  const [value, setValue] = useState(list);
  useEffect(() => { listeners.add(setValue); void load(); return () => { listeners.delete(setValue); }; }, []);
  return value;
}
