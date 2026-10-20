import source from './modifiers/catalog-v43.json';

export interface ModifierExample {
  example_id: string;
  base: string;
  result: string;
  modifier_surface: string | null;
  context_sentence: string;
  operation: { remove: string; append: string; keep_codepoints: number };
}
export interface ModifierEntry { id: string; examples: ModifierExample[] }
// Keep the original inventory, IDs and all examples. Archive practice progress
// is deliberately not imported: every app profile owns its own progress.
export const modifierEntries: readonly ModifierEntry[] = source.entries;
export const modifierById = new Map(modifierEntries.map(entry => [entry.id, entry]));
export interface ModifierProgress { id: string; excluded: boolean; seenAt: number }
export interface ModifierState { progress: ModifierProgress[] }
export interface ModifierDraw extends ModifierState { entryId: string | null }
export type ModifierGroup = 'excluded' | 'seen' | 'unseen';

export function modifierTitle(entry: ModifierEntry): string {
  const surfaces = [...new Set(entry.examples.map(example => example.modifier_surface).filter(Boolean))];
  return surfaces.length ? surfaces.join(' / ') : [...new Set(entry.examples.map(example =>
    `${example.operation.remove || '∅'} → ${example.operation.append || '∅'}`))].join(' / ');
}
export function modifierGroups(state: ModifierState): Record<ModifierGroup, ModifierEntry[]> {
  const progress = new Map(state.progress.map(item => [item.id, item]));
  const groups: Record<ModifierGroup, ModifierEntry[]> = { excluded: [], seen: [], unseen: [] };
  for (const entry of modifierEntries) {
    const item = progress.get(entry.id);
    groups[item?.excluded ? 'excluded' : item ? 'seen' : 'unseen'].push(entry);
  }
  return groups;
}
export function availableModifiers(state: ModifierState, current: string | null): ModifierEntry[] {
  const excluded = new Set(state.progress.filter(item => item.excluded).map(item => item.id));
  const pool = modifierEntries.filter(entry => !excluded.has(entry.id));
  return pool.length > 1 ? pool.filter(entry => entry.id !== current) : pool;
}
