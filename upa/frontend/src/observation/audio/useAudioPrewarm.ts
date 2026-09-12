import { useEffect, useRef } from 'react';
import type { ProfileStateResponse } from '../../../../shared/contracts';
import { preparedAudioCache, type AudioLease } from './prepared-audio';

export function useAudioPrewarm(state: ProfileStateResponse | null) {
  const leases = useRef(new Map<string, { priority: 'active' | 'warm'; lease: AudioLease }>());
  const current = state?.currentObservation?.audio?.url;
  const upcoming = JSON.stringify((state?.upcomingAudio ?? []).slice(0, 3).map(audio => audio.url));
  useEffect(() => {
    const desired = new Map<string, 'active' | 'warm'>();
    if (current) desired.set(current, 'active');
    for (const url of JSON.parse(upcoming) as string[]) if (!desired.has(url)) desired.set(url, 'warm');
    // Acquire/promote before releasing old owners so navigation cannot cancel
    // the just-selected download or revoke a Blob still attached to the player.
    for (const [url, priority] of desired) {
      const previous = leases.current.get(url);
      if (previous?.priority === priority) continue;
      const lease = preparedAudioCache.acquire(url, priority);
      void lease.ready.catch(() => {});
      leases.current.set(url, { priority, lease });
      previous?.lease.release();
    }
    for (const [url, owner] of leases.current) {
      if (desired.has(url)) continue;
      owner.lease.release();
      leases.current.delete(url);
    }
  }, [current, upcoming]);
  useEffect(() => () => {
    for (const owner of leases.current.values()) owner.lease.release();
    leases.current.clear();
  }, []);
}
