import { useEffect, useRef, useState } from 'react';
import { AppearanceProvider } from './appearance';
import { ObservationView } from './observation/ObservationView';
import { ProfileEntry } from './profile/ProfileEntry';
import { useProfileSession, type ProfileSession } from './profile/useProfileSession';
import { SettingsView } from './settings/SettingsView';
import { useSettingsController } from './settings/useSettingsController';
import './styles.css';
export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const session = useProfileSession(settingsOpen);
  return <AppearanceProvider key={session.profileCode ?? 'entry'} profileCode={session.profileCode}>
    <AppContent session={session} settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen} />
  </AppearanceProvider>;
}
function AppContent({ session, settingsOpen, setSettingsOpen }: {
  session: ProfileSession;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}) {
  const gradientStep = useRef(0);
  useEffect(() => {
    if (!session.state?.currentObservation?.id) return;
    gradientStep.current += 1;
    const root = document.documentElement;
    root.style.setProperty('--gradient-turn-a', `${gradientStep.current * 8}deg`);
    root.style.setProperty('--gradient-turn-b', `${gradientStep.current * -5}deg`);
    root.style.setProperty('--gradient-shift', `${Math.sin(gradientStep.current * 0.6) * 3}%`);
  }, [session.state?.currentObservation?.id]);
  const settings = useSettingsController({
    profileCode: session.profileCode,
    state: session.state,
    onSettingsSaved: session.applySelectionSettings,
    onAudioSettingsSaved: session.applyAudioSettings,
    onQueueReset: session.applyProfileState,
  });
  if (!session.profileCode) {
    return (
      <ProfileEntry
        invalidCode={session.invalidCode}
        loadUnavailable={session.loadUnavailable}
        onSubmit={session.submitCode}
        onInputChange={session.clearInvalidCode}
      />
    );
  }
  if (settingsOpen && session.state) {
    return (
      <SettingsView
        state={session.state}
        controller={settings}
        onClose={() => {
          setSettingsOpen(false);
          session.setObservationVisible(
            document.visibilityState === 'visible',
          );
        }}
      />
    );
  }
  return (
    <ObservationView
      state={session.state}
      busy={session.busy}
      navigationEvent={session.navigationEvent}
      onMove={session.move}
      onOpenSettings={() => {
        settings.prepareOpen();
        session.setObservationVisible(false);
        setSettingsOpen(true);
      }}
    />
  );
}
