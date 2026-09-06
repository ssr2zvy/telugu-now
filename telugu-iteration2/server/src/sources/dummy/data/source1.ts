import type { DummyRow } from '../dummy-data-source';

// Fixed Iteration 2 fixture. Lengths were sampled once from a seeded right-skewed
// distribution and are committed literally; runtime selection never regenerates them.
export const source1Rows = [
  { sourceKey: "source1-001", text: "గాలి నెమ్మదిగా వీస్తూ చెట్ల." },
  { sourceKey: "source1-002", text: "చిన్న వర్షం మొదలై వీధి." },
  { sourceKey: "source1-003", text: "కిటికీ దగ్గర." },
  { sourceKey: "source1-004", text: "టీ." },
  { sourceKey: "source1-005", text: "ఆకాశం మళ్లీ స్పష్టంగా కనిపించింది ఈ రోజు ఉదయం." },
  { sourceKey: "source1-006", text: "మా ఇంటి దగ్గర చల్లని గాలి." },
  { sourceKey: "source1-007", text: "చెట్ల ఆకులను." },
  { sourceKey: "source1-008", text: "వీధి అంతా తడిసింది పిల్లలు కిటికీ దగ్గర నిలబడి." },
  { sourceKey: "source1-009", text: "బయట చూసారు అమ్మ వేడి టీ చేసి అందరికీ ఇచ్చింది సాయంత్రం మేఘాలు తొలగి ఆకాశం మళ్లీ." },
  { sourceKey: "source1-010", text: "ఇచ్చింది సాయంత్రం మేఘాలు తొలగి ఆకాశం మళ్లీ స్పష్టంగా కనిపించింది." },
  { sourceKey: "source1-011", text: "కనిపించింది ఈ రోజు ఉదయం మా ఇంటి దగ్గర చల్లని." },
  { sourceKey: "source1-012", text: "చల్లని గాలి నెమ్మదిగా." },
] as const satisfies readonly DummyRow[];
