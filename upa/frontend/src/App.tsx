import { RepositoryView } from './repository/RepositoryView';
import { useState } from 'react';
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
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const session = useProfileSession(settingsOpen || repositoryOpen);
  return <AppearanceProvider key={session.profileCode ?? 'entry'} profileCode={session.profileCode}>
    <AppContent repositoryOpen={repositoryOpen} setRepositoryOpen={setRepositoryOpen} session={session} settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen} />
  </AppearanceProvider>;
}
function AppContent({ session, settingsOpen, setSettingsOpen, repositoryOpen, setRepositoryOpen }: {
  repositoryOpen: boolean; setRepositoryOpen: (open: boolean) => void;
  session: ProfileSession;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}) {
  const gradientTravel = useGradientTravel();
  const [diagnosticFont, setDiagnosticFont] = useState<string | null>(null);
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
  if (repositoryOpen) return <RepositoryView profile={session.profileCode} fontFamily={diagnosticFont ?? 'Noto Sans Telugu'} onClose={() => {
    setRepositoryOpen(false); session.setObservationVisible(document.visibilityState === 'visible');
  }}/>;
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
      onOpenRepository={(fontFamily) => {
        gradientTravel.cancelPreview(); setDiagnosticFont(fontFamily); session.setObservationVisible(false); setRepositoryOpen(true);
      }}
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
