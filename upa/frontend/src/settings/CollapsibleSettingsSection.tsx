import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

interface CollapsibleSettingsSectionProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function CollapsibleSettingsSection({
  title,
  description,
  children,
  className = '',
  ariaLabel,
}: CollapsibleSettingsSectionProps) {
  return (
    <details className={`settings-collapsible-section ${className}`.trim()} role="region" aria-label={ariaLabel} open>
      <summary className="settings-collapsible-heading">
        <span>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="settings-collapsible-content">{children}</div>
    </details>
  );
}