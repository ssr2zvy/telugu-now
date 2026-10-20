import { unzipSync, strFromU8 } from 'fflate';
import type { ModifierEntry } from '../../../shared/modifiers';

// Never extract paths to disk. Bound both compressed and expanded input.
export function readModifierZip(bytes: Uint8Array): ModifierEntry[] {
  if (bytes.length > 8 * 1024 * 1024) throw new Error('archive-too-large');
  let count = 0;
  const files = unzipSync(bytes, { filter: file => {
    if (!/(^|\/)telugu_modifiers\.json$/.test(file.name)) return false;
    if (++count > 1 || file.originalSize > 8 * 1024 * 1024) throw new Error('invalid-archive');
    return true;
  }});
  if (count !== 1) throw new Error('missing-catalog');
  const data = JSON.parse(strFromU8(Object.values(files)[0]!));
  if (!Array.isArray(data.entries) || !data.entries.length || data.entries.length > 5000) throw new Error('invalid-catalog');
  const ids = new Set<string>();
  const text = (v: unknown) => typeof v === 'string' && v.length <= 20000;
  for (const e of data.entries) {
    if (!e || !text(e.id) || !e.id || e.id.length > 200 || ids.has(e.id) || !Array.isArray(e.examples) || !e.examples.length || e.examples.length > 500) throw new Error('invalid-entry');
    ids.add(e.id);
    const examples = new Set<string>();
    for (const x of e.examples) {
      if (!x || !text(x.example_id) || examples.has(x.example_id) || !text(x.base) || !text(x.result) || !text(x.context_sentence) || !(x.modifier_surface === null || text(x.modifier_surface)) || !x.operation || !text(x.operation.remove) || !text(x.operation.append) || !Number.isSafeInteger(x.operation.keep_codepoints) || x.operation.keep_codepoints < 0) throw new Error('invalid-example');
      examples.add(x.example_id);
    }
  }
  return data.entries;
}
