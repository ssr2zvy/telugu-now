import { GrammarMigrationPage } from './pages/GrammarMigrationPage';
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
import { OrganizedAppearancePage } from './pages/OrganizedAppearancePage';
import { ImageGenerationPage } from './pages/ImageGenerationPage';
import { EonsPage } from './pages/EonsPage';
import { BlacklistPage } from './pages/BlacklistPage';
import { QuestionsPage } from './pages/QuestionsPage';
import { QueueViewPage } from './pages/QueueViewPage';
import { ImportPage } from './pages/ImportPage';
import { ControlsGuidePage } from './pages/ControlsGuidePage';
import { AboutPage } from './pages/AboutPage';
interface SettingsViewProps {
  state: ProfileStateResponse;
  controller: SettingsController;
  fontFamily: string | null;
  onClose: () => void;
}
export function SettingsView({
  state,
  controller,
  fontFamily,
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
    playbackAutoplayDraft,
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
  if(page==='grammarMigration')return <SettingsShell {...shellProps} title="Grammar Migration" onBack={controller.backToIndex}><GrammarMigrationPage profileCode={state.profileCode}/></SettingsShell>;
  if(state.grammarActive&&(page==='sources'||page==='complexity'))return <SettingsShell {...shellProps} title="Grammar selection" onBack={controller.backToIndex}><p>Grammar progression now controls selection.</p></SettingsShell>;
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
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <DataSourcesPage language={language} />
      </SettingsShell>
    );
  }
  if (page === 'appearance') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <OrganizedAppearancePage language={language} />
      </SettingsShell>
    );
  }
  if (page === 'eons') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <EonsPage key={state.profileCode} profileCode={state.profileCode} language={language} />
      </SettingsShell>
    );
  }
  if (page === 'blacklist') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <BlacklistPage key={state.profileCode} profileCode={state.profileCode} language={language} />
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
  if (page === 'queue') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <QueueViewPage grammarActive={state.grammarActive??false} key={state.profileCode} profileCode={state.profileCode} language={language} />
      </SettingsShell>
    );
  }
  if (page === 'playback') {
    return (
      <SettingsShell
        {...shellProps}
        title={settingsPageLabel(page, language)}
        onBack={controller.backToIndex}
      >
        <PlaybackSpeedPage
          language={language}
          rate={playbackRateDraft}
          autoplay={playbackAutoplayDraft}
          saving={playbackSaving}
          error={playbackError}
          onRateChange={controller.setPlaybackRateDraft}
          onAutoplayChange={controller.setPlaybackAutoplayDraft}
          onClearError={controller.clearPlaybackError}
          onSave={() => void controller.savePlaybackSettings()}
        />
      </SettingsShell>
    );
  }
  if (page === 'import') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <ImportPage language={language} />
      </SettingsShell>
    );
  }
  if (page === 'controlsGuide') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <ControlsGuidePage language={language} />
      </SettingsShell>
    );
  }
  if (page === 'about') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <AboutPage language={language} />
      </SettingsShell>
    );
  }
  if (page === 'export') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
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
          onChooseFormat={(format) => void controller.chooseExportFormat(format)}
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
  if (page === 'questions') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <QuestionsPage
          grammarActive={state.grammarActive??false}
          language={language}
          draft={draft}
          saving={settingsSaving}
          error={settingsError}
          onDraftChange={controller.setDraft}
          onClearError={controller.clearSettingsError}
          onSave={() => void controller.saveQuestionSettings()}
        />
      </SettingsShell>
    );
  }
  if (page === 'sources') {
    return (
      <SettingsShell
        {...shellProps}
        title={settingsPageLabel(page, language)}
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
  if(state.currentObservation?.grammar && ['source','complexityInfo','global'].includes(page)) {
    const g=state.currentObservation.grammar.target;
    const rows=[['Selected target',g.targetId],['Category',g.categoryLevel],['Modifier chain',JSON.stringify(g.chain)],['Transcript length',g.length],['Category probabilities',JSON.stringify(g.probabilities)],['Selection probabilities',JSON.stringify(g.route)],['Route probability',g.routeProbability],['Inventory',g.inventoryId]];
    return <SettingsShell {...shellProps} title="Grammar selection" onBack={controller.backToIndex}><table className="diagnostic-table"><tbody>{rows.map(([key,value])=><tr key={String(key)}><th>{String(key)}</th><td>{String(value??'—')}</td></tr>)}</tbody></table></SettingsShell>;
  }
  if (page === 'trigger' || page === 'source' || page === 'complexityInfo' || page === 'global' || page === 'questionInfo') {
    return (
      <SettingsShell
        {...shellProps}
        title={settingsPageLabel(page, language)}
        onBack={controller.backToIndex}
      >
        <DiagnosticPage
          sectionKey={page === 'complexityInfo' ? 'complexity' : page === 'questionInfo' ? 'questions' : page}
          state={state}
          language={language}
          fontFamily={fontFamily}
        />
      </SettingsShell>
    );
  }
  return null;
}
