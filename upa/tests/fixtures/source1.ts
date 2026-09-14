import type { DummyRow } from './dummy-data-source';

// Fixed Iteration 2 fixture. Lengths were sampled once from a seeded right-skewed
// distribution and are committed literally; runtime selection never regenerates them.
export const source1Rows = [
  { sourceKey: "source1-001", text: "క".repeat(4) },
  { sourceKey: "source1-002", text: "క".repeat(4) },
  { sourceKey: "source1-003", text: "క".repeat(2) },
  { sourceKey: "source1-004", text: "క".repeat(1) },
  { sourceKey: "source1-005", text: "క".repeat(7) },
  { sourceKey: "source1-006", text: "క".repeat(5) },
  { sourceKey: "source1-007", text: "క".repeat(2) },
  { sourceKey: "source1-008", text: "క".repeat(7) },
  { sourceKey: "source1-009", text: "క".repeat(13) },
  { sourceKey: "source1-010", text: "క".repeat(8) },
  { sourceKey: "source1-011", text: "క".repeat(8) },
  { sourceKey: "source1-012", text: "క".repeat(3) },
] as const satisfies readonly DummyRow[];
