import { useEffect, useRef, useState } from 'react';
import type {
  ProfileAudioSettings,
  ProfileSelectionSettings,
  ProfileStateResponse,
} from '../../../shared/contracts';
import {
  getProfileState,
  loadProfile,
  navigate,
  setVisibility,
} from '../api';
export interface ProfileSession {
  profileCode: string | null;
  state: ProfileStateResponse | null;
  invalidCode: boolean;
  busy: boolean;
  navigationEvent: { sequence: number; direction: 'back' | 'next' } | null;
  submitCode: (code: string) => Promise<boolean>;
  clearInvalidCode: () => void;
  move: (direction: 'back' | 'next') => Promise<boolean>;
  setObservationVisible: (visible: boolean) => void;
  applySelectionSettings: (settings: ProfileSelectionSettings) => void;
  applyAudioSettings: (settings: ProfileAudioSettings) => void;
  applyProfileState: (state: ProfileStateResponse) => void;
}
export function useProfileSession(settingsOpen: boolean): ProfileSession {
  const [profileCode, setProfileCode] = useState<string | null>(null);
  const [state, setState] = useState<ProfileStateResponse | null>(null);
  const [invalidCode, setInvalidCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [navigationEvent, setNavigationEvent] = useState<ProfileSession['navigationEvent']>(null);
  const navigationSequenceRef = useRef(0);
  const navigationInFlightRef = useRef(false);
  const stateRevisionRef = useRef(0);
  const activeCodeRef = useRef<string | null>(null);
  const settingsOpenRef = useRef(settingsOpen);
  useEffect(() => {
    activeCodeRef.current = profileCode;
  }, [profileCode]);
  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);
  useEffect(() => {
    if (!navigationEvent) return;
    const timer = window.setTimeout(() => setNavigationEvent(null), 1500);
    return () => window.clearTimeout(timer);
  }, [navigationEvent]);
  useEffect(() => {
    if (!profileCode) return;
    let cancelled = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || navigationInFlightRef.current) return;
      refreshing = true;
      const revision = stateRevisionRef.current;
      try {
        const observationVisible =
          document.visibilityState === 'visible' && !settingsOpen;
        const next = await getProfileState(profileCode, observationVisible);
        if (!cancelled && !navigationInFlightRef.current && revision === stateRevisionRef.current) {
          setState(next);
        }
      } catch {
        // Keep the last known state. The next poll will retry.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      1_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [profileCode, settingsOpen]);
  useEffect(() => {
    const onVisibility = () => {
      const code = activeCodeRef.current;
      if (!code) return;
      void setVisibility(code, {
        visible:
          document.visibilityState === 'visible' &&
          !settingsOpenRef.current,
      });
    };
    const onPageHide = () => {
      const code = activeCodeRef.current;
      if (!code) return;
      const body = new Blob(
        [JSON.stringify({ visible: false })],
        { type: 'application/json' },
      );
      navigator.sendBeacon(
        `/api/profiles/${code}/visibility`,
        body,
      );
    };
    document.addEventListener(
      'visibilitychange',
      onVisibility,
    );
    window.addEventListener(
      'pagehide',
      onPageHide,
    );
    return () => {
      document.removeEventListener(
        'visibilitychange',
        onVisibility,
      );
      window.removeEventListener(
        'pagehide',
        onPageHide,
      );
    };
  }, []);
  const submitCode = async (
    code: string,
  ): Promise<boolean> => {
    if (!/^\d{3}$/.test(code)) {
      return false;
    }
    setBusy(true);
    setInvalidCode(false);
    try {
      const loaded = await loadProfile({
        code,
        visible:
          document.visibilityState ===
          'visible',
      });
      setProfileCode(code);
      setState(loaded);
      return true;
    } catch {
      setInvalidCode(true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const move = async (
    direction: 'back' | 'next',
  ): Promise<boolean> => {
    if (!profileCode || navigationInFlightRef.current || !(direction === 'back' ? state?.canBack : state?.canNext)) {
      return false;
    }
    navigationInFlightRef.current = true;
    stateRevisionRef.current += 1;
    navigationSequenceRef.current += 1;
    setNavigationEvent({ sequence: navigationSequenceRef.current, direction });
    setBusy(true);
    try {
      const next = await navigate(
        profileCode,
        direction,
        {
          visible:
            document.visibilityState ===
            'visible',
        },
      );
      setState(next);
      return true;
    } catch {
      // Polling refreshes readiness/state.
      return false;
    } finally {
      navigationInFlightRef.current = false;
      setBusy(false);
    }
  };
  const setObservationVisible = (
    visible: boolean,
  ) => {
    if (!profileCode) return;
    void setVisibility(
      profileCode,
      { visible },
    );
  };
  const applySelectionSettings = (
    settings: ProfileSelectionSettings,
  ) => {
    stateRevisionRef.current += 1;
    setState((current) =>
      current
        ? {
            ...current,
            selectionSettings: settings,
          }
        : current,
    );
  };
  const applyAudioSettings = (
    settings: ProfileAudioSettings,
  ) => {
    stateRevisionRef.current += 1;
    setState((current) =>
      current
        ? {
            ...current,
            audioSettings: settings,
          }
        : current,
    );
  };
  const applyProfileState = (
    next: ProfileStateResponse,
  ) => {
    stateRevisionRef.current += 1;
    setState(next);
  };
  return {
    profileCode,
    state,
    invalidCode,
    busy,
    navigationEvent,
    submitCode,
    clearInvalidCode: () =>
      setInvalidCode(false),
    move,
    setObservationVisible,
    applySelectionSettings,
    applyAudioSettings,
    applyProfileState,
  };
}
