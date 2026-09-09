import { useState } from 'react';
import type {
  ExportResponse,
  ProfileAudioSettings,
  ProfileSelectionSettings,
  ProfileStateResponse,
} from '../../../shared/contracts';
import { generateExport, resetQueue as requestQueueReset, updateAudioSettings, updateSelectionSettings } from '../api';
import type {
  ExportFormat,
  PreparedExportArtifact,
} from '../export-artifact';
import { prepareEpubExport } from '../export-epub';
import { prepareHtmlExport } from '../export-html';
import {
  loadSettingsLanguage,
  saveSettingsLanguage,
} from './language';
import { draftFromSettings } from './settings-utils';
import { parentSettingsPage } from './navigation';
import { AUDIO_PLAYBACK_RATE_MIN, AUDIO_PLAYBACK_RATE_MAX } from '../../../shared/audio';
import type {
  SettingsDraft,
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
  page: SettingsPage;
  language: UiLanguage;
  draft: SettingsDraft | null;
  settingsSaving: boolean;
  settingsError: boolean;
  queueResetting: boolean;
  queueResetError: boolean;
  playbackRateDraft: string;
  playbackSaving: boolean;
  playbackError: boolean;
  exportCount: string;
  exporting: boolean;
  exportError: boolean;
  formatChooserOpen: boolean;
  generatedExport: ExportResponse | null;
  preparedArtifact: PreparedExportArtifact | null;
  prepareOpen: () => void;
  enterPage: (page: Exclude<SettingsPage, 'index'>) => void;
  backToIndex: () => void;
  toggleLanguage: () => void;
  setDraft: (draft: SettingsDraft) => void;
  clearSettingsError: () => void;
  saveComplexitySettings: () => Promise<void>;
  saveSourceSettings: () => Promise<void>;
  resetQueue: () => Promise<void>;
  setPlaybackRateDraft: (rate: string) => void;
  clearPlaybackError: () => void;
  savePlaybackSettings: () => Promise<void>;
  setExportCount: (count: string) => void;
  requestExport: () => void;
  cancelFormatChoice: () => void;
  chooseExportFormat: (format: ExportFormat) => Promise<void>;
}
export function useSettingsController({
  profileCode,
  state,
  onSettingsSaved,
  onAudioSettingsSaved,
  onQueueReset,
}: UseSettingsControllerOptions): SettingsController {
  const [page, setPage] = useState<SettingsPage>('index');
  const [language, setLanguage] = useState<UiLanguage>(() =>
    loadSettingsLanguage(),
  );
  const [draft, setDraftState] = useState<SettingsDraft | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [queueResetting, setQueueResetting] = useState(false);
  const [queueResetError, setQueueResetError] = useState(false);
  const [playbackRateDraft, setPlaybackRateDraftState] = useState('1');
  const [playbackSaving, setPlaybackSaving] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [exportCount, setExportCountState] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [formatChooserOpen, setFormatChooserOpen] = useState(false);
  const [generatedExport, setGeneratedExport] = useState<ExportResponse | null>(null);
  const [preparedArtifact, setPreparedArtifact] =
    useState<PreparedExportArtifact | null>(null);
  const invalidateExport = () => {
    setGeneratedExport(null);
    setPreparedArtifact(null);
    setFormatChooserOpen(false);
    setExportError(false);
  };
  const prepareOpen = () => {
    if (!state) return;
    setDraftState(draftFromSettings(state.selectionSettings));
    setPlaybackRateDraftState(String(state.audioSettings.playbackRate));
    setSettingsError(false);
    setExportError(false);
    setQueueResetError(false);
    setPlaybackError(false);
    setFormatChooserOpen(false);
    setPage('index');
  };
  const enterPage = (
    nextPage: Exclude<SettingsPage, 'index'>,
  ) => {
    if (
      state &&
      (nextPage === 'complexity' || nextPage === 'sources')
    ) {
      setDraftState(draftFromSettings(state.selectionSettings));
    }
    if (state && nextPage === 'playback') {
      setPlaybackRateDraftState(String(state.audioSettings.playbackRate));
    }
    setSettingsError(false);
    setExportError(false);
    setQueueResetError(false);
    setPlaybackError(false);
    setFormatChooserOpen(false);
    setPage(nextPage);
  };
  const backToIndex = () => {
    setSettingsError(false);
    setExportError(false);
    setQueueResetError(false);
    setPlaybackError(false);
    setFormatChooserOpen(false);
    setPage(parentSettingsPage(page));
  };
  const toggleLanguage = () => {
    setLanguage((current) => {
      const next = current === 'te' ? 'en' : 'te';
      saveSettingsLanguage(next);
      return next;
    });
  };
  const saveComplexitySettings = async () => {
    if (!profileCode || !state || !draft) return;
    const target = Number(draft.targetPercent) / 100;
    const spread = Number(draft.spreadPercent) / 100;
    const valid =
      Number.isFinite(target) &&
      target >= 0 &&
      target <= 1 &&
      Number.isFinite(spread) &&
      spread > 0;
    if (!valid) {
      setSettingsError(true);
      return;
    }
    setSettingsSaving(true);
    setSettingsError(false);
    try {
      const saved = await updateSelectionSettings(profileCode, {
        sourceWeights: state.selectionSettings.sourceWeights,
        complexityPercentileTarget: target,
        complexityPercentileSpread: spread,
      });
      onSettingsSaved(saved);
      setDraftState(draftFromSettings(saved));
      invalidateExport();
    } catch {
      setSettingsError(true);
    } finally {
      setSettingsSaving(false);
    }
  };
  const saveSourceSettings = async () => {
    if (!profileCode || !state || !draft) return;
    const sourceWeights = Object.fromEntries(
      Object.entries(draft.sourceWeights).map(([sourceId, value]) => [
        sourceId,
        Number(value),
      ]),
    );
    const weights = Object.values(sourceWeights);
    const valid =
      weights.length > 0 &&
      weights.every(
        (value) =>
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 1,
      ) &&
      Math.max(...weights) === 1;
    if (!valid) {
      setSettingsError(true);
      return;
    }
    setSettingsSaving(true);
    setSettingsError(false);
    try {
      const saved = await updateSelectionSettings(profileCode, {
        sourceWeights,
        complexityPercentileTarget:
          state.selectionSettings.complexityPercentileTarget,
        complexityPercentileSpread:
          state.selectionSettings.complexityPercentileSpread,
      });
      onSettingsSaved(saved);
      setDraftState(draftFromSettings(saved));
      invalidateExport();
    } catch {
      setSettingsError(true);
    } finally {
      setSettingsSaving(false);
    }
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
      const saved = await updateAudioSettings(profileCode, { playbackRate: rate });
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
  const requestExport = () => {
    const count = Number(exportCount);
    if (!Number.isInteger(count) || count <= 0) {
      setFormatChooserOpen(false);
      setPreparedArtifact(null);
      setExportError(true);
      return;
    }
    setExportError(false);
    setFormatChooserOpen(true);
  };
  const chooseExportFormat = async (format: ExportFormat) => {
    if (!profileCode) return;
    const count = Number(exportCount);
    if (!Number.isInteger(count) || count <= 0) {
      setFormatChooserOpen(false);
      setExportError(true);
      return;
    }
    setFormatChooserOpen(false);
    setExporting(true);
    setExportError(false);
    setPreparedArtifact(null);
    try {
      let result = generatedExport;
      if (!result) {
        result = await generateExport(profileCode, { count });
        setGeneratedExport(result);
      }
      const prepared =
        format === 'epub'
          ? await prepareEpubExport(result)
          : await prepareHtmlExport(result);
      setPreparedArtifact(prepared);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };
  return {
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
    generatedExport,
    preparedArtifact,
    prepareOpen,
    enterPage,
    backToIndex,
    toggleLanguage,
    setDraft: setDraftState,
    clearSettingsError: () => setSettingsError(false),
    saveComplexitySettings,
    saveSourceSettings,
    resetQueue,
    setPlaybackRateDraft,
    clearPlaybackError,
    savePlaybackSettings,
    setExportCount,
    requestExport,
    cancelFormatChoice: () => setFormatChooserOpen(false),
    chooseExportFormat,
  };
}
