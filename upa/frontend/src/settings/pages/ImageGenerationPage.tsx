import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { CORE_WORD_PLACEHOLDER, IMAGE_MODEL, SENTENCE_PLACEHOLDER, validImagePrompt, type ImageSettings } from '../../../../shared/image-settings';
import type { UiLanguage } from '../types';
import { useAppearance } from '../../appearance';

export function ImageGenerationPage({ language }: { language: UiLanguage }) {
  const { profileCode } = useAppearance();
  const settingsUrl = `/api/word-images/settings?profile=${encodeURIComponent(profileCode ?? '')}`;
  const [settings, setSettings] = useState<ImageSettings | null>(null);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const english = language === 'en';
  useEffect(() => {
    let cancelled = false;
    setError('');
    void fetch(settingsUrl).then(async response => {
      if (!response.ok) throw new Error('Could not load image settings.');
      const result = await response.json() as ImageSettings;
      if (!cancelled) { setSettings(result); setPrompt(result.prompt); }
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load image settings.'); });
    return () => { cancelled = true; };
  }, [attempt, settingsUrl]);
  const save = async () => {
    if (saving || !validImagePrompt(prompt)) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const response = await fetch(settingsUrl, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not save image settings.');
      setSettings(result as ImageSettings);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save image settings.');
    } finally { setSaving(false); }
  };
  return (
    <form className="image-generation-settings" onSubmit={event => { event.preventDefault(); void save(); }}>
      <dl>
        <div><dt>{english ? 'Model' : 'మోడల్'}</dt><dd>MAI Image 2.5 Flash <small>{IMAGE_MODEL}</small></dd></div>
        <div><dt>{english ? 'API key' : 'API కీ'}</dt><dd>{settings ? settings.keyConfigured ? (english ? 'Configured' : 'అమర్చబడింది') : (english ? 'Not configured' : 'అమర్చలేదు') : '...'}</dd></div>
      </dl>
      <label htmlFor="image-generation-prompt">{english ? 'Image prompt' : 'చిత్ర ప్రాంప్ట్'}</label>
      <textarea id="image-generation-prompt" value={prompt} maxLength={2000} rows={7} disabled={!settings || saving}
        aria-describedby="image-prompt-placeholder" aria-invalid={Boolean(settings && !validImagePrompt(prompt))}
        onChange={event => { setPrompt(event.target.value); setSaved(false); setError(''); }} />
      <p id="image-prompt-placeholder" className="image-prompt-requirement">
        {english ? 'Optional placeholders' : 'ఐచ్ఛిక గుర్తులు'}: <code>{CORE_WORD_PLACEHOLDER}</code> <code>{SENTENCE_PLACEHOLDER}</code>
      </p>
      {error ? <p className="settings-error" role="alert">{error}</p> : null}
      {!settings && error ? <button className="secondary-action" type="button" onClick={() => setAttempt(value => value + 1)}>{english ? 'Retry' : 'మళ్లీ ప్రయత్నించు'}</button> : (
        <button className="primary-action" type="submit" disabled={!settings || saving || !validImagePrompt(prompt)}><Save aria-hidden="true" />{saving ? (english ? 'Saving...' : 'భద్రపరుస్తోంది...') : (english ? 'Save' : 'భద్రపరచు')}</button>
      )}
      <div role="status">{saved ? (english ? 'Saved' : 'భద్రపరచబడింది') : ''}</div>
    </form>
  );
}