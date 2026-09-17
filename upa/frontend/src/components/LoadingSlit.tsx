import { useEffect, useState } from 'react';

export function LoadingSlit({ label, progress }: { label: string; progress?: number }) {
  const target = progress === undefined ? null : Math.max(0, Math.min(100, Math.round(progress * 100)));
  const [percentage, setPercentage] = useState(target);
  useEffect(() => {
    if (target === null) { setPercentage(null); return; }
    if (percentage === null || target < percentage) { setPercentage(target); return; }
    if (target === percentage) return;
    const timer = window.setInterval(() => setPercentage(current => {
      if (current === null || current >= target) { window.clearInterval(timer); return target; }
      return Math.min(target, current + Math.max(1, Math.ceil((target - current) / 5)));
    }), 40);
    return () => window.clearInterval(timer);
  }, [target, percentage]);
  return <div className="loading-slit" role="status" aria-label={label}>
    <span className="loading-slit-window" aria-hidden="true">
      <i /><i /><i /><i />
    </span>
    {percentage === null ? null : <output aria-label={`${label}: ${percentage}%`}>{percentage}</output>}
  </div>;
}
