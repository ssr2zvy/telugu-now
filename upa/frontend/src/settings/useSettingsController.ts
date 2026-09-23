import { useRef, useState } from 'react';
import type {
  ExportResponse,
  ProfileAudioSettings,
  ProfileSelectionSettings,
  ProfileStateResponse,
} from '../../../shared/contracts';
import { generateExport, resetQueue as requestQueueReset, updateAudioSettings } from '../api';
import type {
  ExportFormat,
  PreparedExportArtifact,
} from '../export-artifact';
import { prepareEpubExport } from '../export-epub';
import { prepareHtmlExport } from '../export-html';
import { prepareAppArchive } from '../app-archive';
import { useAppearance } from '../appearance';
import { parentSettingsPage } from './navigation';
import { AUDIO_PLAYBACK_RATE_MIN, AUDIO_PLAYBACK_RATE_MAX } from '../../../shared/audio';
import type {
  SettingsPage,
  UiLanguage,
} from './types';
interface UseSettingsControllerOptions {
  profileCode: string | null;
  state: ProfileStateResponse | null;
  onSettingsSaved: (settings: ProfileSelectionSettings) => void;
  onAudioSettingsSaved: (settings: ProfileAudioSettings) => void;
  onQueueReset: (state: ProfileStateResponse) => void;
}
export interface SettingsController {
  acceptState: (state: ProfileStateResponse) => void;
  acceptSettings: (settings: ProfileSelectionSettings) => void;
  page: SettingsPage;
  language: UiLanguage;
  queueResetting: boolean;
  queueResetError: boolean;
  playbackRateDraft: string;
  playbackAutoplayDraft: boolean;
  playbackSaving: boolean;
  playbackError: boolean;
  exportCount: string;
  exporting: boolean;
  exportPhase: 'selecting' | 'packaging';
  exportError: boolean;
  generatedExport: ExportResponse | null;
  preparedArtifact: PreparedExportArtifact | null;
  prepareOpen: () => void;
  enterPage: (page: Exclude<SettingsPage, 'index'>) => void;
  backToIndex: () => void;
  toggleLanguage: () => void;
  resetQueue: () => Promise<void>;
  setPlaybackRateDraft: (rate: string) => void;
  setPlaybackAutoplayDraft: (autoplay: boolean) => void;
  clearPlaybackError: () => void;
  savePlaybackSettings: () => Promise<void>;
  setExportCount: (count: string) => void;
  chooseExportFormat: (format: ExportFormat) => Promise<void>;
}
export function useSettingsController({
  profileCode,
  state,
  onAudioSettingsSaved,
  onSettingsSaved,
  onQueueReset,
}: UseSettingsControllerOptions): SettingsController {
  const [page, setPage] = useState<SettingsPage>('index');
  const pageHistory=useRef<SettingsPage[]>([]);
  const { language, updateLanguage } = useAppearance();
  const [queueResetting, setQueueResetting] = useState(false);
  const [queueResetError, setQueueResetError] = useState(false);
  const [playbackRateDraft, setPlaybackRateDraftState] = useState('1');
  const [playbackAutoplayDraft, setPlaybackAutoplayDraft] = useState(true);
  const [playbackSaving, setPlaybackSaving] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [exportCount, setExportCountState] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportPhase, setExportPhase] = useState<'selecting' | 'packaging'>('selecting');
  const [exportError, setExportError] = useState(false);
  const exportBusy = useRef(false);
  const [generatedExport, setGeneratedExport] = useState<ExportResponse | null>(null);
  const [preparedArtifact, setPreparedArtifact] =
    useState<PreparedExportArtifact | null>(null);
  const invalidateExport = () => {
    setGeneratedExport(null);
    setPreparedArtifact(null);
    setExportError(false);
  };
  const prepareOpen = () => {
    if (!state) return;
    setPlaybackRateDraftState(String(state.audioSettings.playbackRate));
    setPlaybackAutoplayDraft(state.audioSettings.autoplay);
    setExportError(false);
    setQueueResetError(false);
    setPlaybackError(false);
    pageHistory.current=[];
    setPage('index');
  };
  const enterPage = (
    nextPage: Exclude<SettingsPage, 'index'>,
  ) => {
    if (state && nextPage === 'playback') {
      setPlaybackRateDraftState(String(state.audioSettings.playbackRate));
      setPlaybackAutoplayDraft(state.audioSettings.autoplay);
    }
    setExportError(false);
    setQueueResetError(false);
    setPlaybackError(false);
    if(nextPage!==page)pageHistory.current.push(page);
    setPage(nextPage);
  };
  const backToIndex = () => {
    setExportError(false);
    setQueueResetError(false);
    setPlaybackError(false);
    setPage(pageHistory.current.pop()??parentSettingsPage(page));
  };
  const toggleLanguage = () => {
    updateLanguage(language === 'te' ? 'en' : 'te');
  };
  const resetQueue = async () => {
    if (!profileCode) return;
    setQueueResetting(true);
    setQueueResetError(false);
    try {
      const next = await requestQueueReset(profileCode, { visible: false });
      onQueueReset(next);
    } catch {
      setQueueResetError(true);
    } finally {
      setQueueResetting(false);
    }
  };
  const setPlaybackRateDraft = (rate: string) => {
    setPlaybackRateDraftState(rate);
  };
  const clearPlaybackError = () => setPlaybackError(false);
  const savePlaybackSettings = async () => {
    if (!profileCode) return;
    const rate = Number(playbackRateDraft);
    if (!Number.isFinite(rate) || rate < AUDIO_PLAYBACK_RATE_MIN || rate > AUDIO_PLAYBACK_RATE_MAX) {
      setPlaybackError(true);
      return;
    }
    setPlaybackSaving(true);
    setPlaybackError(false);
    try {
      const saved = await updateAudioSettings(profileCode, { playbackRate: rate, autoplay: playbackAutoplayDraft });
      onAudioSettingsSaved(saved);
      setPlaybackRateDraftState(String(saved.playbackRate));
    } catch {
      setPlaybackError(true);
    } finally {
      setPlaybackSaving(false);
    }
  };
  const setExportCount = (count: string) => {
    setExportCountState(count);
    invalidateExport();
  };
  const chooseExportFormat = async (format: ExportFormat) => {
    if (!profileCode || exportBusy.current) return;
    const count = Number(exportCount);
    if (!Number.isInteger(count) || count <= 0 || count > 500) {
      setExportError(true);
      return;
    }
    exportBusy.current = true;
    setExporting(true);
    setExportPhase('selecting');
    setExportError(false);
    setPreparedArtifact(null);
    try {
      const result = await generateExport(profileCode, { count });
      setGeneratedExport(result);
      setExportPhase('packaging');
      const prepared = format === 'epub'
        ? await prepareEpubExport(result)
        : format === 'html'
          ? await prepareHtmlExport(result)
          : await prepareAppArchive(result, profileCode);
      setPreparedArtifact(prepared);
    } catch {
      setExportError(true);
    } finally {
      exportBusy.current = false;
      setExporting(false);
    }
  };
  return {
    acceptState: onQueueReset,
    acceptSettings: onSettingsSaved,
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
    exportPhase,
    exportError,
    generatedExport,
    preparedArtifact,
    prepareOpen,
    enterPage,
    backToIndex,
    toggleLanguage,
    resetQueue,
    setPlaybackRateDraft,
    setPlaybackAutoplayDraft,
    clearPlaybackError,
    savePlaybackSettings,
    setExportCount,
    chooseExportFormat,
  };
}
