import type { CSSProperties } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ObservationAudio } from '../../../../shared/contracts';
import type { ObservationFontFamily } from '../../presentation';
import { AudioPlayerBar } from '../audio/AudioPlayerBar';
import { AUDIO_LEAD_IN_SECONDS, silentLeadInUrl } from '../audio/silent-lead-in';

interface LetterProfileProps {
  letter: string;
  fontFamily: ObservationFontFamily;
  playbackRate: number;
  onBack: () => void;
}

export function LetterProfile({ letter, fontFamily, playbackRate, onBack }: LetterProfileProps) {
  const dummyAudio: ObservationAudio = {
    url: silentLeadInUrl(),
    mimeType: 'audio/wav',
    durationSeconds: AUDIO_LEAD_IN_SECONDS,
  };

  return (
    <section className="letter-profile-page controls-visible" aria-labelledby="letter-profile-title">
      <button type="button" className="word-profile-back" aria-label="Back to word" onClick={onBack}>
        <ArrowLeft size={20} aria-hidden="true" />
      </button>
      <div className="letter-profile-center">
        <h2 id="letter-profile-title" lang="te" style={{ fontFamily: `"${fontFamily}", "Noto Sans Telugu", sans-serif` } as CSSProperties}>
          {letter}
        </h2>
        <AudioPlayerBar
          audio={dummyAudio}
          sourceId={null}
          sourceKey={null}
          defaultPlaybackRate={playbackRate}
          autoplay={false}
          controlsVisible
          playbackEnabled
        />
      </div>
    </section>
  );
}
