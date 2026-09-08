import type { DummyRow } from '../dummy-data-source';

// Fixed Iteration 2 fixture. Lengths were sampled once from a seeded right-skewed
// distribution and are committed literally; runtime selection never regenerates them.
export const source2Rows = [
  { sourceKey: "source2-001", text: "సససససససససస" },
  { sourceKey: "source2-002", text: "ససససససససస" },
  { sourceKey: "source2-003", text: "సససససససససస" },
  { sourceKey: "source2-004", text: "ససససససససస" },
  { sourceKey: "source2-005", text: "సససససససససససససససససససస" },
  { sourceKey: "source2-006", text: "ససససససస" },
  { sourceKey: "source2-007", text: "సససససససససససస" },
  { sourceKey: "source2-008", text: "సససససససససససససస" },
  { sourceKey: "source2-009", text: "సససససససససస" },
  { sourceKey: "source2-010", text: "ససససససససససససససస" },
  { sourceKey: "source2-011", text: "సస" },
  { sourceKey: "source2-012", text: "సససససస" },
  { sourceKey: "source2-013", text: "సససససససస" },
  { sourceKey: "source2-014", text: "సససససససససససససస" },
  { sourceKey: "source2-015", text: "సససససస" },
  { sourceKey: "source2-016", text: "ససససససససస" },
  { sourceKey: "source2-017", text: "ససససససససస" },
  { sourceKey: "source2-018", text: "సససససససససససస" },
  { sourceKey: "source2-019", text: "ససససససససససససస" },
  { sourceKey: "source2-020", text: "ససససససససస" },
  { sourceKey: "source2-021", text: "ససససససససస" },
  { sourceKey: "source2-022", text: "ససససససససససస" },
  { sourceKey: "source2-023", text: "సససససససససససససససససస" },
  { sourceKey: "source2-024", text: "సససససససస" },
] as const satisfies readonly DummyRow[];
