import { CategoryPage } from './pages/CategoryPage';
import { GrammarQuestionTypePage } from './pages/GrammarQuestionTypePage';
import { GrammarMigrationPage } from './pages/GrammarMigrationPage';
import type { ProfileStateResponse } from '../../../shared/contracts';
import { ParserDiagnosticsPage } from './pages/ParserDiagnosticsPage';
import { DataSourcesPage } from './pages/DataSourcesPage';
import { SettingsShell } from './SettingsShell';
import type { SettingsController } from './useSettingsController';
import { DiagnosticPage } from './pages/DiagnosticPage';
import { ExportPage } from './pages/ExportPage';
import { PlaybackSpeedPage } from './pages/PlaybackSpeedPage';
import { SettingsIndex } from './pages/SettingsIndex';
import { settingsGroups, settingsPageLabel, exportFormatForPage } from './navigation';
import { OrganizedAppearancePage } from './pages/OrganizedAppearancePage';
import { ImageGenerationPage } from './pages/ImageGenerationPage';
import { EonsPage } from './pages/EonsPage';
import { BlacklistPage } from './pages/BlacklistPage';
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
    queueResetting,
    queueResetError,
    playbackRateDraft,
    playbackAutoplayDraft,
    playbackSaving,
    playbackError,
    exportCount,
    exporting,
    exportError,
    preparedArtifact,
  } = controller;
  const shellProps = {
    language,
    page,
    profileCode: state.profileCode,
    migrationAvailable: state.grammarMigrationAvailable ?? false,
    onNavigate: controller.enterPage,
    onOverview: controller.prepareOpen,
    onClose,
    onToggleLanguage: controller.toggleLanguage,
  };
  if(page==='category')return <SettingsShell {...shellProps} title={settingsPageLabel(page,language)} onBack={controller.backToIndex}><CategoryPage key={state.profileCode} profileCode={state.profileCode}/></SettingsShell>;
  if(page==='grammarMigration' && state.grammarMigrationAvailable)return <SettingsShell {...shellProps} title="Grammar Migration" onBack={controller.backToIndex}><GrammarMigrationPage profileCode={state.profileCode}/></SettingsShell>;
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
  if (page === 'archiveImport') {
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
  if (page === 'epubExport' || page === 'htmlExport' || page === 'archiveExport') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <ExportPage
          language={language}
          count={exportCount}
          exporting={exporting}
          phase={controller.exportPhase}
          error={exportError}
          format={exportFormatForPage[page]}
          preparedArtifact={preparedArtifact?.format === exportFormatForPage[page] ? preparedArtifact : null}
          onCountChange={controller.setExportCount}
          onRequestExport={() => void controller.chooseExportFormat(exportFormatForPage[page])}
        />
      </SettingsShell>
    );
  }
  if (page === 'parser') return <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}><ParserDiagnosticsPage profileCode={state.profileCode} selected={state.currentObservation?.grammar?.target ?? null} language={language}/></SettingsShell>;
  if (page === 'questionInfo' && state.currentObservation?.grammar) return <SettingsShell {...shellProps} title="Question type" onBack={controller.backToIndex}><GrammarQuestionTypePage selected={state.currentObservation.grammar.target} mode={state.currentObservation.question?.mode ?? null}/></SettingsShell>;
  if(state.currentObservation?.grammar && ['source','complexityInfo','global'].includes(page)) {
    const g=state.currentObservation.grammar.target;
    const rows=[['Selected target',g.targetId],['Category',g.categoryLevel],['Core grammar base',g.coreBaseId??'—'],['Grammatical components',JSON.stringify(g.components??g.chain)],['Modifier chain',JSON.stringify(g.chain)],['Transcript length',g.length],['Category probabilities',JSON.stringify(g.probabilities)],['Selection probabilities',JSON.stringify(g.route)],['Route probability',g.routeProbability],['Inventory',g.inventoryId]];
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
