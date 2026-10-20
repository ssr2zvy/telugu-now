import { useEffect, useRef, useState } from 'react';
import { modifierById, modifierGroups, type ModifierState } from '../../../shared/modifiers';
import { modifierApi } from './api';

export function useModifierMode(profile: string | null) {
  const [state, setState] = useState<ModifierState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [index, setIndex] = useState(-1);
  const lock = useRef(false);
  const epoch = useRef(0);
  const retryAction = useRef<() => void>(() => {});
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (lock.current) return;
    const version = epoch.current;
    lock.current = true; setBusy(true); setError(false);
    retryAction.current = () => { void run(operation); };
    try { await operation(); }
    catch { if (version === epoch.current) setError(true); }
    finally { if (version === epoch.current) { lock.current = false; setBusy(false); } }
  };
  useEffect(() => {
    const version = ++epoch.current;
    lock.current = false; setState(null); setHistory([]); setIndex(-1);
    if (profile) void run(async () => {
      const loaded = await modifierApi.state(profile);
      if (version === epoch.current) setState(loaded);
    });
    return () => { epoch.current++; };
  }, [profile]);
  const id = history[index] ?? null;
  const groups = state ? modifierGroups(state) : null;
  return {
    state, groups, busy, error, index,
    entry: id ? (state?.entries ? state.entries.find(e => e.id === id) : modifierById.get(id)) ?? null : null,
    omitted: Boolean(id && state?.omitted?.includes(id)),
    excluded: state?.progress.find(item => item.id === id)?.excluded ?? false,
    remaining: groups ? groups.seen.length + groups.unseen.length : null,
    retry: () => retryAction.current(),
    next: () => run(async () => {
      if (!profile || !state) return;
      if (index < history.length - 1) { setIndex(index + 1); return; }
      const version = epoch.current;
      const result = await modifierApi.draw(profile, id);
      if (version !== epoch.current) return;
      setState(result);
      setHistory(previous => [...previous.slice(0, index + 1), result.entryId]);
      setIndex(index + 1);
    }),
    back: () => { if (!lock.current && index > 0) { setIndex(index - 1); setError(false); } },
    setExcluded: (entryId: string, excluded: boolean) => run(async () => {
      if (!profile) return;
      const version = epoch.current;
      const result = await modifierApi.setExcluded(profile, entryId, excluded);
      if (version === epoch.current) setState(result);
    }),
    setOmitted: (entryId: string, omitted: boolean) => run(async () => {
      if (!profile) return;
      const version = epoch.current;
      const result = await modifierApi.setOmitted(profile, entryId, omitted);
      if (version === epoch.current) setState(result);
    }),
    importZip: (file: File) => run(async () => {
      if (!profile) return;
      const version = epoch.current;
      const result = await modifierApi.importZip(profile, file);
      if (version !== epoch.current) return;
      setState(result); setHistory([]); setIndex(-1);
    }),
    reset: () => run(async () => {
      if (!profile) return;
      const version = epoch.current;
      const result = await modifierApi.reset(profile);
      if (version !== epoch.current) return;
      setState(result); setHistory([]); setIndex(-1);
    }),
  };
}
export type ModifierController = ReturnType<typeof useModifierMode>;
