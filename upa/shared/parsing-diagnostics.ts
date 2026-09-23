export interface SearchAttempt {
  id:string; cycleId:string; targetId:string; core:number; startedAt:number; endedAt:number|null;
  checked:number; returned:number|null; examined:number|null; parsed:number|null; matching:number|null; reused:number|null;
  outcome:string|null; word:string|null; stage:string|null; searchSucceeded:boolean|null; error:string|null;
}
export interface ChainSearch {
  id:string; core:number; endedAt:number|null; endReason:string|null;
  searches:SearchAttempt[];
}
export interface TargetDiagnostic {
  id: string; core: number; kind: 'vocabulary' | 'chain'; label: string;
  example?: string;
  forms: string[]; chain: string[]; chainAlternatives: string[][];
  matchedWords: number|null; searches:number; checked:number; exhausted:number;
  pattern:{needles:string[];maxCodepoints:number;scope:string}|null;
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
  cache:{total:number;checked:number;parsed:number;rejected:number;validParses?:number}|null;
  selectionPolicy:'shortest-codepoints-v1';
  worker:{phase:string;error:string|null};
  queue:{depth:number;preparing:number;ready:number;pending:number;failed:number;errors:string[]};
  activity:{phase:string;target:string|null;checked:number;error:string|null};
  cycles:{total:number;active:number;steps:number;reasons:Array<{reason:string;count:number}>};
  currentChain:{id:string;core:number;endReason:string|null;currentObservationId:string;
    steps:Array<{observationId:string;targetId:string;label:string;word:string|null;displayed:boolean;answered:boolean}>}|null;
  searchTotals?:{total:number;checked:number;matched:number;exhausted:number;interrupted:number};
  upcoming?:Array<{observationId:string;targetId:string;cycleId:string|null;word:string|null;status:string;error:string|null}>;
  activeSearch?:{id:string;cycleId:string;targetId:string;startedAt:number;checked:number}|null;
  recentCycles?:Array<{id:string;core:number;startedAt:number;endedAt:number|null;endReason:string|null;words:string[]}>;
  chainSearches?:ChainSearch[];
  lastAttempt?:SearchAttempt|null;
  guider?:{generating:boolean;cycleId:string|null};
  allTime?:{successfulSearches:number;examined:number;legacyEvaluated:number;trackedSince:number|null};
  historyNotice:string;
}
