export interface TargetDiagnostic {
  id: string; core: number; kind: 'vocabulary' | 'chain'; label: string;
  forms: string[]; chain: string[]; chainAlternatives: string[][];
  streak: number; mastered: boolean; corpusRows: number | null;
  corpusTexts: number | null; audioReferenceRows: number | null;
  selected: number; displayed: number; answered: number; pendingAnswers: number;
}
export interface CoreDiagnostic {
  core: number; total: number; mastered: number; percent: number | null;
  vocabulary: { total:number; mastered:number; percent:number|null };
  modifiers: { total:number; mastered:number; percent:number|null };
  withExamples:number|null; withoutExamples:number|null; pendingAnswers:number;
  status: 'completed' | 'current' | 'upcoming';
}
export interface DiagnosticEvent {
  seq:number; occurred_at:number; type:string; core:number|null; batch_id:string|null;
  observation_id:string|null; target_id:string|null; slot:number|null; details:Record<string,unknown>;
}
export interface ParsingDiagnostics {
  version:1; generatedAt:number; auditStartedAt:number; currentCore:number;
  inventoryId:string|null; catalogError:string|null; progressError:string|null;
  levels:CoreDiagnostic[]; targets:TargetDiagnostic[];
  historyNotice:string;
}
