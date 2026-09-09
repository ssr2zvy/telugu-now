import type { UiLanguage } from './types';
const SETTINGS_LANGUAGE_KEY = 'telugu-now-settings-language';
export const COPY = {
  en: {
    settings: 'Settings',
    complexity: 'Complexity',
    sourceWeights: 'Source weights',
    diagnostic: 'Diagnostic',
    export: 'Export',
    dataSources: 'Data sources', provider: 'Provider', license: 'License', sourceRepository: 'Source repository', catalogVersion: 'Catalog version', acceptedRows: 'Accepted rows', rejectedRows: 'Rejected rows', sourceStatus: 'Status', complexityMetric: 'Complexity metric', sourceReady: 'Ready', sourceFixture: 'Development fixture', sourceInvalid: 'Invalid',

    resetQueue: 'Reset queue',
    resetQueueDescription: 'Clear queued observations and start over with the current settings.',
    resettingQueue: 'Resetting…',
    resetQueueError: 'Could not reset the queue',

    playbackSpeed: 'Playback speed',
    defaultPlaybackRate: 'Default speed (x)',

    target: 'Target',
    spread: 'Spread',
    save: 'Save',
    saving: 'Saving…',
    invalidValues: 'Invalid values',
    count: 'Count',
    exporting: 'Exporting…',
    download: 'Download',
    ready: 'Ready',
    invalidExport: 'Invalid count or export failed',
    close: 'Close',
    back: 'Back',
    language: 'Switch language',
    yes: 'Yes',
    no: 'No',
    unavailable: 'Unavailable',
    initialFill: 'Initial fill',
    observationConsumed: 'Observation consumed',
    chooseExportFormat: 'Choose export format',
    epub: 'EPUB',
    epubDescription: 'iPhone / iPad · Apple Books · Interactive · Offline',
    html: 'HTML',
    htmlDescription: 'Browser / Desktop · Interactive · Offline',
    cancel: 'Cancel',
  },
  te: {
    settings: 'అమరికలు',
    complexity: 'సంక్లిష్టత',
    sourceWeights: 'మూల బరువులు',
    diagnostic: 'నిర్ధారణ సమాచారం',
    export: 'ఎగుమతి',
    dataSources: 'డేటా మూలాలు', provider: 'ప్రదాత', license: 'లైసెన్స్', sourceRepository: 'మూల రిపోజిటరీ', catalogVersion: 'క్యాటలాగ్ సంచిక', acceptedRows: 'ఆమోదించిన వరుసలు', rejectedRows: 'తిరస్కరించిన వరుసలు', sourceStatus: 'స్థితి', complexityMetric: 'సంక్లిష్టత ప్రమాణం', sourceReady: 'సిద్ధం', sourceFixture: 'అభివృద్ధి నమూనా', sourceInvalid: 'చెల్లదు',

    resetQueue: 'క్యూ రీసెట్ చేయి',
    resetQueueDescription: 'వరుసలో ఉన్న పరిశీలనలను తొలగించి, ప్రస్తుత అమరికలతో మళ్లీ మొదలుపెట్టండి.',
    resettingQueue: 'రీసెట్ అవుతోంది…',
    resetQueueError: 'క్యూను రీసెట్ చేయలేకపోయాము',

    playbackSpeed: 'ప్లేబ్యాక్ వేగం',
    defaultPlaybackRate: 'దినెల వేగం (x)',

    target: 'లక్ష్యం',
    spread: 'వ్యాప్తి',
    save: 'భద్రపరచు',
    saving: 'భద్రపరుస్తోంది…',
    invalidValues: 'చెల్లని విలువలు',
    count: 'సంఖ్య',
    exporting: 'ఎగుమతి అవుతోంది…',
    download: 'డౌన్‌లోడ్',
    ready: 'సిద్ధం',
    invalidExport: 'చెల్లని సంఖ్య లేదా ఎగుమతి విఫలమైంది',
    close: 'మూసివేయి',
    back: 'వెనుక',
    language: 'భాష మార్చు',
    yes: 'అవును',
    no: 'కాదు',
    unavailable: 'అందుబాటులో లేదు',
    initialFill: 'ప్రారంభ నింపుదల',
    observationConsumed: 'పరిశీలన వినియోగం',
    chooseExportFormat: 'ఎగుమతి రూపాన్ని ఎంచుకోండి',
    epub: 'EPUB',
    epubDescription: 'iPhone / iPad · Apple Books · పరస్పర · ఆఫ్‌లైన్',
    html: 'HTML',
    htmlDescription: 'బ్రౌజర్ / డెస్క్‌టాప్ · పరస్పర · ఆఫ్‌లైన్',
    cancel: 'రద్దు',
  },
} as const;
export function t(
  language: UiLanguage,
  key: keyof typeof COPY.en,
): string {
  return COPY[language][key];
}
export function loadSettingsLanguage(): UiLanguage {
  const stored = window.localStorage.getItem(SETTINGS_LANGUAGE_KEY);
  return stored === 'en' || stored === 'te' ? stored : 'te';
}
export function saveSettingsLanguage(language: UiLanguage): void {
  window.localStorage.setItem(SETTINGS_LANGUAGE_KEY, language);
}
