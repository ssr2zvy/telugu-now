export function DiagnosticsDownloadPage({profileCode}:{profileCode:string}) {
  return <section className="settings-info-page">
    <h2>Full observation and chain history</h2>
    <p>Download every recorded observation, selection, connection cycle and search for this profile across all sessions, with no date or row limit.</p>
    <ul>
      <li>Observation text, matched word and occurrence, selected object, selection rules, question type and preparation details.</li>
      <li>Connection chains, their steps and end reasons, searches, Unicode and length rules, and recorded events.</li>
      <li>Answers, response text, presentation history, Core progress, coverage counts and queued questions.</li>
      <li>The Core object inventory and its mapped connections.</li>
    </ul>
    <p>Records are linked by observation, object and cycle IDs. Older records include whatever evidence was saved at the time. Audio files are not embedded; audio response metadata is included.</p>
    <a className="primary-action" href={`/api/profiles/${encodeURIComponent(profileCode)}/parsing/diagnostics/export`} download>Download all diagnostics (JSON)</a>
    <p>The download includes all recorded history, beyond the latest events shown on the main diagnostics page.</p>
  </section>;
}
