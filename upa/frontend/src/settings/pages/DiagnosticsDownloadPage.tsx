export function DiagnosticsDownloadPage({profileCode}:{profileCode:string}) {
  return <div className="parser-settings">
    <p>All recorded observations, selections and connection cycles, across every session.</p>
    <a className="primary-action" href={`/api/profiles/${encodeURIComponent(profileCode)}/parsing/diagnostics/export`} download>Download JSON</a>
    <section className="parser-block">
      <ul><li>Observations, matched words and selection rules</li><li>Chains, searches and recorded events</li><li>Answers, progress and presentation history</li><li>Core objects, Unicode rules and connections</li></ul>
      <p className="parser-muted">No date or row limit. Older entries include the evidence saved at the time. Audio metadata is included; audio files are not.</p>
    </section>
  </div>;
}
