import { useState } from 'react';
import { ObservationView } from './observation/ObservationView';
import { ProfileEntry } from './profile/ProfileEntry';
import { useProfileSession } from './profile/useProfileSession';
import { SettingsView } from './settings/SettingsView';
import { useSettingsController } from './settings/useSettingsController';
import './styles.css';
export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const session = useProfileSession(settingsOpen);
  const settings = useSettingsController({
    profileCode: session.profileCode,
    state: session.state,
    onSettingsSaved: session.applySelectionSettings,
    onQueueReset: session.applyProfileState,
  });
  if (!session.profileCode) {
    return (
      <ProfileEntry
        invalidCode={session.invalidCode}
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
      onMove={session.move}
      onOpenSettings={() => {
        settings.prepareOpen();
        session.setObservationVisible(false);
        setSettingsOpen(true);
      }}
    />
  );
}
