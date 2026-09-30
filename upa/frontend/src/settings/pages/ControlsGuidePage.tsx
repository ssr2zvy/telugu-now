import type { UiLanguage } from '../types';

interface ControlsGuidePageProps {
  language: UiLanguage;
}

const guides = {
  en: [
    ['Exploration', 'With the audio bar hidden, swipe up to draw a random letter or word. Swipe up for another draw; swipe down to retrace and return to the observation. Tap to hear the selection. Each visit starts at your starting probabilities.'],
    ['Navigate', 'Swipe left to move forward and right to go back, including over revealed controls. Desktop arrow keys do the same.'],
    ['Read', 'Double-tap a word to inspect it. Tap the background to play or pause.'],
    ['Audio', 'Tap the audio timeline to seek. Press and hold it to open the magnifier, then drag for precise movement.'],
    ['Bookmarks & playback', 'Swipe down to reveal the bar, then down again to open its controls. Swipe up to close each layer.'],
    ['Text-given questions', 'Use the microphone button to start and stop an answer recording. Recording begins at the current audio cursor.'],
    ['Audio-given questions', 'Listen to the prompt, then enter the response with the Telugu keyboard.'],
    ['Settings', 'Open Settings with the bottom-right icon. Back returns one level.'],
  ],
  te: [
    ['అన్వేషణ', 'ఆడియో బార్ దాచినప్పుడు పైకి స్వైప్ చేస్తే యాదృచ్ఛిక అక్షరం లేదా పదం కనిపిస్తుంది. మళ్లీ పైకి స్వైప్ చేస్తే మరో ఎంపిక; కిందికి స్వైప్ చేస్తే వెనక్కి వెళ్లవచ్చు. వినడానికి నొక్కండి. ప్రతిసారి ప్రారంభ అవకాశాలతో మొదలవుతుంది.'],
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
