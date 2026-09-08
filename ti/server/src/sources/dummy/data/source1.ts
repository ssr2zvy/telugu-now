import type { DummyRow } from '../dummy-data-source';

// Fixed Iteration 2 fixture. Lengths were sampled once from a seeded right-skewed
// distribution and are committed literally; runtime selection never regenerates them.
export const source1Rows = [
  { sourceKey: "source1-001", text: "కకకక" },
  { sourceKey: "source1-002", text: "కకకక" },
  { sourceKey: "source1-003", text: "కక" },
  { sourceKey: "source1-004", text: "క" },
  { sourceKey: "source1-005", text: "కకకకకకక" },
  { sourceKey: "source1-006", text: "కకకకక" },
  { sourceKey: "source1-007", text: "కక" },
  { sourceKey: "source1-008", text: "కకకకకకక" },
  { sourceKey: "source1-009", text: "కకకకకకకకకకకకక" },
  { sourceKey: "source1-010", text: "కకకకకకకక" },
  { sourceKey: "source1-011", text: "కకకకకకకక" },
  { sourceKey: "source1-012", text: "కకక" },
] as const satisfies readonly DummyRow[];
