import type {
  ChangeEvent,
} from 'react';
import { Check } from 'lucide-react';
import {
  t,
} from '../language';
import type {
  UiLanguage,
} from '../types';
import { AUDIO_PLAYER_PRESENTATION } from '../../observation/audio/audio-player-presentation';
interface PlaybackSpeedPageProps {
  language: UiLanguage;
  rate: string;
  autoplay: boolean;
  saving: boolean;
  error: boolean;
  onRateChange: (rate: string) => void;
  onAutoplayChange: (autoplay: boolean) => void;
  onClearError: () => void;
  onSave: () => void;
}
export function PlaybackSpeedPage({
  language,
  rate,
  autoplay,
  saving,
  error,
  onRateChange,
  onAutoplayChange,
  onClearError,
  onSave,
}: PlaybackSpeedPageProps) {
  return (
    <div className="settings-form">
      <label>
        <span>
          {t(
            language,
            'defaultPlaybackRate',
          )}
        </span>
        <input
          type="number"
          inputMode="decimal"
          min={AUDIO_PLAYER_PRESENTATION.playbackRateMin}
          max={AUDIO_PLAYER_PRESENTATION.playbackRateMax}
          step={AUDIO_PLAYER_PRESENTATION.playbackRateStep}
          value={rate}
          onChange={(
            event:
              ChangeEvent<HTMLInputElement>,
          ) => {
            onClearError();
            onRateChange(event.target.value);
          }}
        />
      </label>
      <label className="settings-switch-row">
        <span>{language === 'en' ? 'Autoplay New Observations' : 'కొత్త పరిశీలనలను స్వయంచాలకంగా ప్లే చేయి'}</span>
        <input type="checkbox" role="switch" checked={autoplay} onChange={event => onAutoplayChange(event.target.checked)} />
      </label>
      {error ? (
        <div className="settings-error">
          {t(
            language,
            'invalidValues',
          )}
        </div>
      ) : null}
      <button
        className="primary-action"
        type="button"
        disabled={saving}
        onClick={onSave}
      >
        <Check aria-hidden="true" />
        {saving
          ? t(
              language,
              'saving',
            )
          : t(
              language,
              'save',
            )}
      </button>
    </div>
  );
}
