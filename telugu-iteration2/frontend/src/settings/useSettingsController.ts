import {
  useState,
} from 'react';
import type {
  ProfileSelectionSettings,
  ProfileStateResponse,
} from '../../../shared/contracts';
import {
  generateExport,
  updateSelectionSettings,
} from '../api';
import {
  prepareStandaloneExportHtml,
  type PreparedStandaloneExport,
} from '../export-html';
import {
  loadSettingsLanguage,
  saveSettingsLanguage,
} from './language';
import {
  draftFromSettings,
} from './settings-utils';
import type {
  SettingsDraft,
  SettingsPage,
  UiLanguage,
} from './types';
interface UseSettingsControllerOptions {
  profileCode: string | null;
  state: ProfileStateResponse | null;
  onSettingsSaved: (
    settings: ProfileSelectionSettings,
  ) => void;
}
export interface SettingsController {
  page: SettingsPage;
  language: UiLanguage;
  draft: SettingsDraft | null;
  settingsSaving: boolean;
  settingsError: boolean;
  exportCount: string;
  exporting: boolean;
  exportError: boolean;
  preparedExport: PreparedStandaloneExport | null;
  prepareOpen: () => void;
  enterPage: (
    page: Exclude<SettingsPage, 'index'>,
  ) => void;
  backToIndex: () => void;
  toggleLanguage: () => void;
  setDraft: (draft: SettingsDraft) => void;
  clearSettingsError: () => void;
  saveComplexitySettings: () => Promise<void>;
  saveSourceSettings: () => Promise<void>;
  setExportCount: (count: string) => void;
  startExport: () => Promise<void>;
}
export function useSettingsController({
  profileCode,
  state,
  onSettingsSaved,
}: UseSettingsControllerOptions): SettingsController {
  const [page, setPage] = useState<SettingsPage>('index');
  const [language, setLanguage] = useState<UiLanguage>(() =>
    loadSettingsLanguage(),
  );
  const [draft, setDraftState] = useState<SettingsDraft | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [exportCount, setExportCountState] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [preparedExport, setPreparedExport] =
    useState<PreparedStandaloneExport | null>(null);
  const prepareOpen = () => {
    if (!state) return;
    setDraftState(draftFromSettings(state.selectionSettings));
    setSettingsError(false);
    setExportError(false);
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
    setSettingsError(false);
    setExportError(false);
    setPage(nextPage);
  };
  const backToIndex = () => {
    setSettingsError(false);
    setExportError(false);
    setPage('index');
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
      setPreparedExport(null);
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
      setPreparedExport(null);
    } catch {
      setSettingsError(true);
    } finally {
      setSettingsSaving(false);
    }
  };
  const setExportCount = (count: string) => {
    setExportCountState(count);
    setPreparedExport(null);
    setExportError(false);
  };
  const startExport = async () => {
    if (!profileCode) return;
    const count = Number(exportCount);
    if (!Number.isInteger(count) || count <= 0) {
      setPreparedExport(null);
      setExportError(true);
      return;
    }
    setExporting(true);
    setExportError(false);
    setPreparedExport(null);
    try {
      const result = await generateExport(profileCode, { count });
      const prepared = await prepareStandaloneExportHtml(result);
      setPreparedExport(prepared);
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
    exportCount,
    exporting,
    exportError,
    preparedExport,
    prepareOpen,
    enterPage,
    backToIndex,
    toggleLanguage,
    setDraft: setDraftState,
    clearSettingsError: () => setSettingsError(false),
    saveComplexitySettings,
    saveSourceSettings,
    setExportCount,
    startExport,
  };
}
