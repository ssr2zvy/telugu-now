import { useLayoutEffect, useState } from 'react';
import { useGradientTravel } from './GradientBackdrop';
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
  const gradientTravel = useGradientTravel();
  const [diagnosticFont, setDiagnosticFont] = useState<string | null>(null);
  useLayoutEffect(() => {
    gradientTravel.synchronize(session.state?.currentPosition ?? null);
  }, [gradientTravel, session.state?.currentPosition]);
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
        fontFamily={diagnosticFont}
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
      onOpenSettings={(fontFamily) => {
        gradientTravel.cancelPreview();
        setDiagnosticFont(fontFamily);
        settings.prepareOpen();
        session.setObservationVisible(false);
        setSettingsOpen(true);
      }}
    />
  );
}
