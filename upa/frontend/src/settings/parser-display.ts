import type { ParsingDiagnostics, TargetDiagnostic } from '../../../shared/parsing-diagnostics';

// These are the actual inventory forms/search needles, never translated internal IDs.
export function targetUnicode(target: TargetDiagnostic | undefined): string[] {
  const candidates = target?.forms.length ? target.forms : target?.pattern?.needles?.length ? target.pattern.needles : target?.example ? [target.example] : [];
  return [...new Set(candidates.filter(value => /\p{Script=Telugu}/u.test(value)))];
}
export function completion(data: ParsingDiagnostics) {
  const total = data.levels.reduce((sum, level) => sum + level.total, 0);
  const done = data.levels.reduce((sum, level) => sum + level.mastered, 0);
  return {total,done,percent:total ? Math.floor(1000 * done / total) / 10 : 0};
}

export function chainWord(word:string|null|undefined,target:TargetDiagnostic|undefined):string {
  return word || targetUnicode(target).join(' · ') || 'No saved word';
}
