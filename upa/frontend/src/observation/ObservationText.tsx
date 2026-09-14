import { splitLetterMods } from './letter-mods';
import { useAppearance } from '../appearance';

/**
 * Renders observation text, optionally tinting letter modifications. The base
 * letters keep the configured text color exactly; only the modifications get a
 * more saturated shade.
 */
export function ObservationText({ text }: { text: string }) {
  const { appearance } = useAppearance();
  if (!appearance.highlightMods) return <>{text}</>;
  return (
    <>
      {splitLetterMods(text).map((span, index) => (
        span.kind === 'mod'
          ? <span className="letter-mod" key={index}>{span.text}</span>
          : <span key={index}>{span.text}</span>
      ))}
    </>
  );
}
