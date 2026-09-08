import type { ProfileStateResponse } from '../../../shared/contracts';
import { t } from './language';
import { DataSourcesPage } from './pages/DataSourcesPage';
import { SettingsShell } from './SettingsShell';
import type { SettingsController } from './useSettingsController';
import { ComplexityPage } from './pages/ComplexityPage';
import { DiagnosticPage } from './pages/DiagnosticPage';
import { ExportPage } from './pages/ExportPage';
import { SettingsIndex } from './pages/SettingsIndex';
import { SourceWeightsPage } from './pages/SourceWeightsPage';
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
    exportCount,
    exporting,
    exportError,
    formatChooserOpen,
    preparedArtifact,
  } = controller;
  const shellProps = {
    language,
    onClose,
    onToggleLanguage: controller.toggleLanguage,
  };
  if (page === 'index') {
    return (
      <SettingsShell
        {...shellProps}
        title={t(language, 'settings')}
      >
        <SettingsIndex
          language={language}
          onNavigate={controller.enterPage}
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
  if (page === 'diagnostic') {
    return (
      <SettingsShell
        {...shellProps}
        title={t(language, 'diagnostic')}
        onBack={controller.backToIndex}
      >
        <DiagnosticPage
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
