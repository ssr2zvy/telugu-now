import type { DummyRow } from '../dummy-data-source';

// Fixed Iteration 2 fixture. Lengths were sampled once from a seeded right-skewed
// distribution and are committed literally; runtime selection never regenerates them.
export const source2Rows = [
  { sourceKey: "source2-001", text: "స".repeat(10) },
  { sourceKey: "source2-002", text: "స".repeat(9) },
  { sourceKey: "source2-003", text: "స".repeat(10) },
  { sourceKey: "source2-004", text: "స".repeat(9) },
  { sourceKey: "source2-005", text: "స".repeat(20) },
  { sourceKey: "source2-006", text: "స".repeat(7) },
  { sourceKey: "source2-007", text: "స".repeat(12) },
  { sourceKey: "source2-008", text: "స".repeat(14) },
  { sourceKey: "source2-009", text: "స".repeat(10) },
  { sourceKey: "source2-010", text: "స".repeat(15) },
  { sourceKey: "source2-011", text: "స".repeat(2) },
  { sourceKey: "source2-012", text: "స".repeat(6) },
  { sourceKey: "source2-013", text: "స".repeat(8) },
  { sourceKey: "source2-014", text: "స".repeat(14) },
  { sourceKey: "source2-015", text: "స".repeat(6) },
  { sourceKey: "source2-016", text: "స".repeat(8) },
  { sourceKey: "source2-017", text: "స".repeat(8) },
  { sourceKey: "source2-018", text: "స".repeat(12) },
  { sourceKey: "source2-019", text: "స".repeat(13) },
  { sourceKey: "source2-020", text: "స".repeat(9) },
  { sourceKey: "source2-021", text: "స".repeat(9) },
  { sourceKey: "source2-022", text: "స".repeat(11) },
  { sourceKey: "source2-023", text: "స".repeat(18) },
  { sourceKey: "source2-024", text: "స".repeat(8) },
] as const satisfies readonly DummyRow[];
