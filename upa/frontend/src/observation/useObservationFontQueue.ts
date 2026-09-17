import { useRef } from 'react';
import type { ProfileStateResponse } from '../../../shared/contracts';
import { OBSERVATION_FONTS, type ObservationFontFamily } from '../presentation';

export interface ObservationFontAssignment {
  id: string;
  text: string;
  fontFamily: ObservationFontFamily;
}

interface FontDeck {
  key: string;
  order: ObservationFontFamily[];
  cursor: number;
  assignments: Map<string, ObservationFontFamily>;
}

function shuffled(fonts: readonly ObservationFontFamily[]): ObservationFontFamily[] {
  const result = [...fonts];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

export function useObservationFontQueue(
  state: ProfileStateResponse | null,
  enabledFonts: readonly ObservationFontFamily[],
): ObservationFontAssignment[] {
  const available = enabledFonts.length ? enabledFonts : OBSERVATION_FONTS;
  const key = `${state?.profileCode ?? ''}\0${available.join('\0')}`;
  const deckRef = useRef<FontDeck | null>(null);
  if (!deckRef.current || deckRef.current.key !== key) {
    deckRef.current = { key, order: shuffled(available), cursor: 0, assignments: new Map() };
  }
  const deck = deckRef.current;
  const entries = [
    ...(state?.currentObservation ? [{ id: state.currentObservation.id, text: state.currentObservation.text }] : []),
    ...(state?.upcomingPresentation ?? []),
    ...(state?.previousPresentation ? [state.previousPresentation] : []),
  ].filter((entry, index, all) => all.findIndex(candidate => candidate.id === entry.id) === index).slice(0, 3);
  return entries.map(entry => {
    let fontFamily = deck.assignments.get(entry.id);
    if (!fontFamily) {
      fontFamily = deck.order[deck.cursor % deck.order.length]!;
      deck.cursor += 1;
      deck.assignments.set(entry.id, fontFamily);
    }
    return { ...entry, fontFamily };
  });
}