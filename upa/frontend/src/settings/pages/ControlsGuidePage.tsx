import type { UiLanguage } from '../types';

interface ControlsGuidePageProps {
  language: UiLanguage;
}

const guides = {
  en: [
    ['Navigate', 'Tap or click the left and right reading regions to move back or forward. In scroll mode, swipe horizontally.'],
    ['Read', 'Select text with a pointer, or press and hold a word on touch screens to open its reading actions.'],
    ['Audio', 'Tap the audio timeline to seek. Press and hold it to open the magnifier, then drag for precise movement.'],
    ['Bookmarks & playback', 'Open the audio controls to add bookmarks, change speed, or choose a loop mode.'],
    ['Text-given questions', 'Use the microphone button to start and stop an answer recording. Recording begins at the current audio cursor.'],
    ['Audio-given questions', 'Listen to the prompt, then enter the response with the Telugu keyboard.'],
    ['Settings', 'Use Back to return one level, the overview control to return to Settings, and the language control to switch the interface language.'],
  ],
  te: [
    ['నావిగేషన్', 'వెనుకకు లేదా ముందుకు వెళ్లడానికి ఎడమ మరియు కుడి పఠన ప్రాంతాలను నొక్కండి. స్క్రోల్ మోడ్‌లో అడ్డంగా స్వైప్ చేయండి.'],
    ['చదవడం', 'పాయింటర్‌తో వచనాన్ని ఎంచుకోండి లేదా టచ్ స్క్రీన్‌పై పదాన్ని నొక్కి పట్టుకుని పఠన చర్యలను తెరవండి.'],
    ['ఆడియో', 'స్థానం మార్చడానికి ఆడియో కాలరేఖను నొక్కండి. మాగ్నిఫైయర్ తెరవడానికి నొక్కి పట్టుకుని, ఖచ్చితమైన కదలిక కోసం లాగండి.'],
    ['బుక్‌మార్క్‌లు మరియు ప్లేబ్యాక్', 'బుక్‌మార్క్‌లు జోడించడానికి, వేగం మార్చడానికి లేదా లూప్ మోడ్ ఎంచుకోవడానికి ఆడియో నియంత్రణలను తెరవండి.'],
    ['వచనం ఇచ్చిన ప్రశ్నలు', 'సమాధాన రికార్డింగ్‌ను ప్రారంభించడానికి మరియు ఆపడానికి మైక్రోఫోన్ బటన్‌ను ఉపయోగించండి. ప్రస్తుత ఆడియో కర్సర్ వద్ద రికార్డింగ్ మొదలవుతుంది.'],
    ['ఆడియో ఇచ్చిన ప్రశ్నలు', 'ప్రాంప్ట్‌ను విని, తెలుగు కీబోర్డ్‌తో సమాధానాన్ని నమోదు చేయండి.'],
    ['అమరికలు', 'ఒక స్థాయి వెనక్కి వెళ్లడానికి వెనుక బటన్‌ను, అమరికల అవలోకనానికి వెళ్లడానికి అవలోకన నియంత్రణను, భాష మార్చడానికి భాష నియంత్రణను ఉపయోగించండి.'],
  ],
} as const;

export function ControlsGuidePage({ language }: ControlsGuidePageProps) {
  return (
    <div className="settings-info-page">
      <p>{language === 'en' ? 'Controls change with the current reading or question stage.' : 'ప్రస్తుత పఠనం లేదా ప్రశ్న దశను బట్టి నియంత్రణలు మారుతాయి.'}</p>
      <ul className="controls-guide-list">
        {guides[language].map(([title, description]) => (
          <li key={title}>
            <strong>{title}</strong>
            <span>{description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
