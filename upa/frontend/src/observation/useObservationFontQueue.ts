import { useRef } from 'react';
import type { ProfileStateResponse } from '../../../shared/contracts';
import { compatibleObservationFonts, type ObservationFontFamily } from '../presentation';

export interface ObservationFontAssignment {
  id: string;
  text: string;
  fontFamily: ObservationFontFamily;
}

interface FontDeck {
  key: string;
  visits: ReturnType<typeof createObservationFontDeck>;
}

interface FontVisitState {
  currentId: string | null;
  sequences: Map<string, FontSequence>;
}

interface FontSequence {
  order: ObservationFontFamily[];
  cursor: number;
  visited: boolean;
}

function shuffled(fonts: readonly ObservationFontFamily[], random = Math.random): ObservationFontFamily[] {
  const result = [...fonts];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

export function createObservationFontDeck(
  fonts: readonly ObservationFontFamily[],
  random = Math.random,
) {
  const deck: FontVisitState = { currentId: null, sequences: new Map() };
  const sequenceFor = (id: string) => {
    let sequence = deck.sequences.get(id);
    if (!sequence) {
      sequence = { order: shuffled(fonts, random), cursor: 0, visited: false };
      deck.sequences.set(id, sequence);
    }
    return sequence;
  };
  return {
    assignments(entries: Array<{ id: string; text: string }>, currentId: string | null): ObservationFontAssignment[] {
      if (currentId && currentId !== deck.currentId) {
        const current = sequenceFor(currentId);
        if (current.visited) current.cursor = (current.cursor + 1) % current.order.length;
        else current.visited = true;
        deck.currentId = currentId;
      } else if (!currentId) {
        deck.currentId = null;
      }
      return entries.map(entry => {
        const sequence = sequenceFor(entry.id);
        const cursor = entry.id === currentId || !sequence.visited
          ? sequence.cursor
          : (sequence.cursor + 1) % sequence.order.length;
        return { ...entry, fontFamily: sequence.order[cursor]! };
      });
    },
  };
}

export function useObservationFontQueue(
  state: ProfileStateResponse | null,
  enabledFonts: readonly ObservationFontFamily[],
): ObservationFontAssignment[] {
  const available = compatibleObservationFonts(enabledFonts);
  const key = `${state?.profileCode ?? ''}\0${available.join('\0')}`;
  const deckRef = useRef<FontDeck | null>(null);
  if (!deckRef.current || deckRef.current.key !== key) {
    deckRef.current = { key, visits: createObservationFontDeck(available) };
  }
  const entries = [
    ...(state?.currentObservation ? [{ id: state.currentObservation.id, text: state.currentObservation.text }] : []),
    ...(state?.upcomingPresentation ?? []),
    ...(state?.previousPresentation ? [state.previousPresentation] : []),
  ].filter((entry, index, all) => all.findIndex(candidate => candidate.id === entry.id) === index).slice(0, 3);
  return deckRef.current.visits.assignments(entries, state?.currentObservation?.id ?? null);
}