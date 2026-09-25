import { isAppearancePage } from './appearance-navigation';
import { ParserDetailPage } from './pages/ParserDetailPage';
import { ParserCurrentPage } from './pages/ParserCurrentPage';
import { DiagnosticsDownloadPage } from './pages/DiagnosticsDownloadPage';
import { ParsingPage } from './pages/ParsingPage';
import { NormalWeightingPage } from './pages/NormalWeightingPage';
import { CategoryPage } from './pages/CategoryPage';
import { GrammarQuestionTypePage } from './pages/GrammarQuestionTypePage';
import { GrammarMigrationPage } from './pages/GrammarMigrationPage';
import type { ProfileStateResponse } from '../../../shared/contracts';
import { ParserDiagnosticsPage } from './pages/ParserDiagnosticsPage';
import { DataSourcesPage, DataSourceDetailPage } from './pages/DataSourcesPage';
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
    onOverview: controller.openOverview,
    onClose,
    onToggleLanguage: controller.toggleLanguage,
  };
  if(isAppearancePage(page))return <SettingsShell {...shellProps} title={page==='appearanceFont'?(controller.selectedFont??settingsPageLabel(page,language)):settingsPageLabel(page,language)} onBack={controller.backToIndex}>
    <OrganizedAppearancePage language={language} page={page} onNavigate={controller.enterPage} font={controller.selectedFont} onFont={controller.openAppearanceFont}/>
  </SettingsShell>;
  if(page==='dataSources')return <SettingsShell {...shellProps} title={settingsPageLabel(page,language)} onBack={controller.backToIndex}><DataSourcesPage language={language} onSelect={controller.openDataSource}/></SettingsShell>;
  if(page==='dataSourceDetail')return <SettingsShell {...shellProps} title={controller.selectedDataSource?.displayName??settingsPageLabel(page,language)} onBack={controller.backToIndex}><DataSourceDetailPage language={language} source={controller.selectedDataSource}/></SettingsShell>;
  if(["searchAttempt", "currentChain", "nextChainSearch", "lastSearchAttempt", "resetChain", "resetCore", "resetAllCores", "coreProgress", "objectCoverage", "coverageNotes", "searchAndParse", "currentSearches", "allTimeSearches", "cycleHistory", "parserEvents", "parserDetails"].includes(page) && page!=='searchAndParse') return <SettingsShell {...shellProps} title={settingsPageLabel(page,language)} onBack={controller.backToIndex}><ParserDetailPage key={`${state.profileCode}:${page}`} page={page} selectedAttempt={controller.selectedAttempt} onAttempt={controller.openSearchAttempt} profileCode={state.profileCode} observation={state.currentObservation} onNavigate={controller.enterPage} onState={controller.acceptState}/></SettingsShell>;
  if(page==='parsingMode')return <SettingsShell {...shellProps} title={settingsPageLabel(page,language)} onBack={controller.backToIndex}><ParsingPage key={state.profileCode} profileCode={state.profileCode} onState={controller.acceptState}/></SettingsShell>;

  if(page==='category')return <SettingsShell {...shellProps} title={settingsPageLabel(page,language)} onBack={controller.backToIndex}><CategoryPage key={state.profileCode} profileCode={state.profileCode}/></SettingsShell>;
  if(page==='grammarMigration' && state.grammarMigrationAvailable)return <SettingsShell {...shellProps} title="Grammar Migration" onBack={controller.backToIndex}><GrammarMigrationPage profileCode={state.profileCode}/></SettingsShell>;
  if ((settingsGroups[page] && page !== 'parserCurrent') || page === 'reset') {
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
  if (page === 'eons') {
    return (
      <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}>
        <EonsPage key={state.profileCode} profileCode={state.profileCode} language={language} />
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
  if (page === 'parserCurrent') return <SettingsShell {...shellProps} title={settingsPageLabel(page,language)} onBack={controller.backToIndex}><ParserCurrentPage key={state.profileCode} profileCode={state.profileCode} observation={state.currentObservation} onState={controller.acceptState} onNavigate={controller.enterPage}/></SettingsShell>;
  if (page === 'diagnosticsDownload') return <SettingsShell {...shellProps} title={settingsPageLabel(page,language)} onBack={controller.backToIndex}><DiagnosticsDownloadPage profileCode={state.profileCode}/></SettingsShell>;
  if (page === 'diagnostic') return <SettingsShell {...shellProps} title={settingsPageLabel(page, language)} onBack={controller.backToIndex}><ParserDiagnosticsPage profileCode={state.profileCode} observation={state.currentObservation} language={language} onDownload={()=>controller.enterPage('diagnosticsDownload')} onNavigate={controller.enterPage}/></SettingsShell>;
  if (page === 'questionInfo' && state.currentObservation?.grammar) return <SettingsShell {...shellProps} title="Question type" onBack={controller.backToIndex}><GrammarQuestionTypePage selected={state.currentObservation.grammar.target} mode={state.currentObservation.question?.mode ?? null}/></SettingsShell>;
  if (['trigger','source','complexityInfo','global','questionInfo','complexity','sources'].includes(page)) {
    return <SettingsShell {...shellProps} title="Live parsing diagnostics" onBack={controller.backToIndex}><ParserDiagnosticsPage profileCode={state.profileCode} observation={state.currentObservation} language={language} onDownload={()=>controller.enterPage('diagnosticsDownload')} onNavigate={controller.enterPage}/></SettingsShell>;
  }
  return null;
}
