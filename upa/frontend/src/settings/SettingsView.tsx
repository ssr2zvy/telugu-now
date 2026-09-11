import type { ProfileStateResponse } from '../../../shared/contracts';
import { t } from './language';
import { DataSourcesPage } from './pages/DataSourcesPage';
import { SettingsShell } from './SettingsShell';
import type { SettingsController } from './useSettingsController';
import { ComplexityPage } from './pages/ComplexityPage';
import { DiagnosticPage } from './pages/DiagnosticPage';
import { ExportPage } from './pages/ExportPage';
import { PlaybackSpeedPage } from './pages/PlaybackSpeedPage';
import { SettingsIndex } from './pages/SettingsIndex';
import { SourceWeightsPage } from './pages/SourceWeightsPage';
import { settingsGroups, settingsPageLabel } from './navigation';
import { AppearancePage } from './pages/AppearancePage';
import { ImageGenerationPage } from './pages/ImageGenerationPage';
interface SettingsViewProps {
  state: ProfileStateResponse;
  controller: SettingsController;
  onClose: () => void;
}
export function SettingsView({
  state,
  controller,
  onClose,
}: SettingsViewProps) {
  const {
    page,
    language,
    draft,
    settingsSaving,
    settingsError,
    queueResetting,
    queueResetError,
    playbackRateDraft,
    playbackSaving,
    playbackError,
    exportCount,
    exporting,
    exportError,
    formatChooserOpen,
    preparedArtifact,
  } = controller;
  const shellProps = {
    language,
    page,
    profileCode: state.profileCode,
    onNavigate: controller.enterPage,
    onOverview: controller.prepareOpen,
    onClose,
    onToggleLanguage: controller.toggleLanguage,
  };
  if (settingsGroups[page] || page === 'reset') {
    return (
      <SettingsShell
        {...shellProps}
        title={settingsPageLabel(page, language)}
        {...(page === 'index' ? {} : { onBack: controller.backToIndex })}
      >
        <SettingsIndex
          page={page}
          language={language}
          state={state}
          resetting={queueResetting}
          resetError={queueResetError}
          onNavigate={controller.enterPage}
          onResetQueue={() => void controller.resetQueue()}
        />
      </SettingsShell>
    );
  }
  if (page === 'dataSources') {
    return (
      <SettingsShell {...shellProps} title={t(language, 'dataSources')} onBack={controller.backToIndex}>
        <DataSourcesPage language={language} />
      </SettingsShell>
    );
  }
  if (page === 'appearance') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <AppearancePage language={language} />
      </SettingsShell>
    );
  }
  if (page === 'images') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <ImageGenerationPage language={language} />
      </SettingsShell>
    );
  }
  if (page === 'playback') {
    return (
      <SettingsShell
        {...shellProps}
        title={t(language, 'playbackSpeed')}
        onBack={controller.backToIndex}
      >
        <PlaybackSpeedPage
          language={language}
          rate={playbackRateDraft}
          saving={playbackSaving}
          error={playbackError}
          onRateChange={controller.setPlaybackRateDraft}
          onClearError={controller.clearPlaybackError}
          onSave={() => void controller.savePlaybackSettings()}
        />
      </SettingsShell>
    );
  }

  if (!draft) {
    return null;
  }
  if (page === 'complexity') {
    return (
      <SettingsShell
        {...shellProps}
        title={t(language, 'complexity')}
        onBack={controller.backToIndex}
      >
        <ComplexityPage
          language={language}
          draft={draft}
          saving={settingsSaving}
          error={settingsError}
          onDraftChange={controller.setDraft}
          onClearError={controller.clearSettingsError}
          onSave={() => void controller.saveComplexitySettings()}
        />
      </SettingsShell>
    );
  }
  if (page === 'sources') {
    return (
      <SettingsShell
        {...shellProps}
        title={t(language, 'sourceWeights')}
        onBack={controller.backToIndex}
      >
        <SourceWeightsPage
          language={language}
          draft={draft}
          saving={settingsSaving}
          error={settingsError}
          onDraftChange={controller.setDraft}
          onClearError={controller.clearSettingsError}
          onSave={() => void controller.saveSourceSettings()}
        />
      </SettingsShell>
    );
  }
  if (page === 'trigger' || page === 'source' || page === 'complexityInfo' || page === 'global') {
    return (
      <SettingsShell
        {...shellProps}
        title={settingsPageLabel(page, language)}
        onBack={controller.backToIndex}
      >
        <DiagnosticPage
          sectionKey={page === 'complexityInfo' ? 'complexity' : page}
          state={state}
          language={language}
        />
      </SettingsShell>
    );
  }
  return (
    <SettingsShell
      {...shellProps}
      title={t(language, 'export')}
      onBack={controller.backToIndex}
    >
      <ExportPage
        language={language}
        count={exportCount}
        exporting={exporting}
        phase={controller.exportPhase}
        error={exportError}
        formatChooserOpen={formatChooserOpen}
        preparedArtifact={preparedArtifact}
        onCountChange={controller.setExportCount}
        onRequestExport={controller.requestExport}
        onCancelFormatChoice={controller.cancelFormatChoice}
        onChooseFormat={(format) =>
          void controller.chooseExportFormat(format)
        }
      />
    </SettingsShell>
  );
}
