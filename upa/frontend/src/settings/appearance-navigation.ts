// Appearance routes are shared by the header, menu, back navigation and controls.
export const appearanceLabels = {
  "appearanceBackground": [
    "Background",
    "నేపథ్యం"
  ],
  "appearanceBackgroundColors": [
    "Colors",
    "రంగులు"
  ],
  "appearanceBackground1": [
    "Color 1",
    "రంగు 1"
  ],
  "appearanceBackground2": [
    "Color 2",
    "రంగు 2"
  ],
  "appearanceBackground3": [
    "Color 3",
    "రంగు 3"
  ],
  "appearanceRandom": [
    "Randomize colors",
    "యాదృచ్ఛిక రంగులు"
  ],
  "appearanceText": [
    "Reading text & icons",
    "అక్షరాలు & చిహ్నాలు"
  ],
  "appearanceForeground": [
    "Color",
    "రంగు"
  ],
  "appearanceSize": [
    "Type size",
    "అక్షరాల పరిమాణం"
  ],
  "appearanceTextPosition": [
    "Position",
    "స్థానం"
  ],
  "appearanceFonts": [
    "Fonts",
    "ఫాంట్లు"
  ],
  "appearanceFont": [
    "Font",
    "ఫాంట్"
  ],
  "appearanceModifications": [
    "Letter modifications",
    "అక్షర మార్పులు"
  ],
  "appearanceHighlight": [
    "Highlight mods",
    "మార్పుల హైలైట్"
  ],
  "appearanceModificationColor": [
    "Gradient end color",
    "గ్రేడియంట్ ముగింపు రంగు"
  ],
  "appearanceGradientBarrier": [
    "Gradient barrier",
    "గ్రేడియంట్ అవరోధం"
  ],
  "appearanceAudio": [
    "Audio controls",
    "ఆడియో నియంత్రణలు"
  ],
  "appearanceDarkness": [
    "Darkness",
    "ముదురు స్థాయి"
  ],
  "appearanceAudioPosition": [
    "Position",
    "స్థానం"
  ],
  "appearanceAudioOffset": [
    "Audio bar offset",
    "ఆడియో బార్ స్థానం"
  ],
  "appearanceMagnifierPosition": [
    "Magnifier position",
    "మాగ్నిఫైయర్ స్థానం"
  ],
  "appearanceSpacing": [
    "Spacing",
    "అంతరం"
  ],
  "appearanceBarGap": [
    "Audio bar gap",
    "ఆడియో బార్ అంతరం"
  ],
  "appearanceMagnifierGap": [
    "Magnifier gap",
    "మాగ్నిఫైయర్ అంతరం"
  ],
  "appearanceBehavior": [
    "Behavior",
    "ప్రవర్తన"
  ],
  "appearanceTimestamp": [
    "Audio timestamp",
    "ఆడియో సమయం"
  ],
  "appearanceMagnifierHighlight": [
    "Magnifier highlight",
    "మాగ్నిఫైయర్ హైలైట్"
  ],
  "appearanceTrigger": [
    "Toggle trigger",
    "టాగుల్ ట్రిగ్గర్"
  ],
  "appearanceFade": [
    "Auto-fade",
    "స్వయంచాలకంగా దాచడం"
  ],
  "appearanceSurfaces": [
    "Settings & popovers",
    "అమరికలు & పాప్‌ఓవర్లు"
  ],
  "appearanceSurfaceColor": [
    "Surface color",
    "ఉపరితల రంగు"
  ],
  "appearanceBackground1Wheel": [
    "Color wheel",
    "రంగు చక్రం"
  ],
  "appearanceBackground2Wheel": [
    "Color wheel",
    "రంగు చక్రం"
  ],
  "appearanceBackground3Wheel": [
    "Color wheel",
    "రంగు చక్రం"
  ],
  "appearanceForegroundWheel": [
    "Color wheel",
    "రంగు చక్రం"
  ],
  "appearanceModificationColorWheel": [
    "Color wheel",
    "రంగు చక్రం"
  ],
  "appearanceSurfaceColorWheel": [
    "Color wheel",
    "రంగు చక్రం"
  ]
} as const;
export type AppearancePage = 'appearance' | keyof typeof appearanceLabels;
export const appearanceGroups:Partial<Record<AppearancePage,AppearancePage[]>> = {
  "appearance": [
    "appearanceBackground",
    "appearanceText",
    "appearanceModifications",
    "appearanceAudio",
    "appearanceSurfaces"
  ],
  "appearanceBackground": [
    "appearanceBackgroundColors",
    "appearanceRandom"
  ],
  "appearanceBackgroundColors": [
    "appearanceBackground1",
    "appearanceBackground2",
    "appearanceBackground3"
  ],
  "appearanceText": [
    "appearanceForeground",
    "appearanceSize",
    "appearanceTextPosition",
    "appearanceFonts"
  ],
  "appearanceModifications": [
    "appearanceHighlight",
    "appearanceModificationColor",
    "appearanceGradientBarrier"
  ],
  "appearanceAudio": [
    "appearanceDarkness",
    "appearanceAudioPosition",
    "appearanceSpacing",
    "appearanceBehavior",
    "appearanceFade"
  ],
  "appearanceAudioPosition": [
    "appearanceAudioOffset",
    "appearanceMagnifierPosition"
  ],
  "appearanceSpacing": [
    "appearanceBarGap",
    "appearanceMagnifierGap"
  ],
  "appearanceBehavior": [
    "appearanceTimestamp",
    "appearanceMagnifierHighlight",
    "appearanceTrigger"
  ],
  "appearanceSurfaces": [
    "appearanceSurfaceColor"
  ],
  "appearanceFonts": [
    "appearanceFont"
  ],
  "appearanceBackground1": [
    "appearanceBackground1Wheel"
  ],
  "appearanceBackground2": [
    "appearanceBackground2Wheel"
  ],
  "appearanceBackground3": [
    "appearanceBackground3Wheel"
  ],
  "appearanceForeground": [
    "appearanceForegroundWheel"
  ],
  "appearanceModificationColor": [
    "appearanceModificationColorWheel"
  ],
  "appearanceSurfaceColor": [
    "appearanceSurfaceColorWheel"
  ]
};
export function isAppearancePage(page:string):page is AppearancePage {return page==='appearance'||page in appearanceLabels;}
export function appearancePageLabel(page:AppearancePage,language:'en'|'te'):string {return page==='appearance'?(language==='en'?'Appearance':'రూపం'):appearanceLabels[page][language==='en'?0:1];}
