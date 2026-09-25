/** One sequence owns the corner until its arrow has finished. Parent event expiry
 * is deliberately not a completion signal: loading may still be in progress. */
export interface NavigationEvent { sequence: number; direction: 'back' | 'next' }
export interface NavigationFeedbackState {
  owner: string | null;
  event: NavigationEvent | null;
  ready: boolean;
  finished: boolean;
  generation: number;
}
export const NAVIGATION_FEEDBACK_MS = 1500;
export const initialNavigationFeedback: NavigationFeedbackState = {
  owner: null, event: null, ready: false, finished: true, generation: 0,
};
export function synchronizeNavigationFeedback(
  state: NavigationFeedbackState, owner: string | null, event: NavigationEvent | null, ready: boolean,
): NavigationFeedbackState {
  if (owner !== state.owner) {
    return { owner, event, ready, finished: !event, generation: state.generation + 1 };
  }
  if (event && event.sequence !== state.event?.sequence) {
    return { owner, event, ready, finished: false, generation: state.generation + 1 };
  }
  if (state.event && !state.finished && ready !== state.ready) {
    return { ...state, ready, generation: state.generation + 1 };
  }
  return state;
}
export function finishNavigationFeedback(state: NavigationFeedbackState, generation: number): NavigationFeedbackState {
  return state.generation === generation && state.ready && !state.finished
    ? { ...state, finished: true } : state;
}
