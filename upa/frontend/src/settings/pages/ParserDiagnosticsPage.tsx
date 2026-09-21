import { useEffect, useState } from 'react';
import type { GrammarParserDiagnostics } from '../../../../shared/contracts';
import type { UiLanguage } from '../types';

const display = (value: unknown): string => value === null || value === undefined || value === ''
  ? '—' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);

export function ParserDiagnosticsPage({profileCode, selected, language}: {
  profileCode: string; selected: Record<string, unknown> | null; language: UiLanguage;
}) {
  const [data, setData] = useState<GrammarParserDiagnostics | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const label = (en: string, te: string) => language === 'en' ? en : te;
  useEffect(() => {
    const abort = new AbortController();
    setData(null); setError('');
    void fetch(`/api/profiles/${encodeURIComponent(profileCode)}/grammar/diagnostics`, {signal:abort.signal})
      .then(async response => {const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Diagnostics unavailable'); return result as GrammarParserDiagnostics;})
      .then(result => {if (!abort.signal.aborted) setData(result);})
      .catch(reason => {if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));});
    return () => abort.abort();
  }, [profileCode, refresh]);
  const parsed = selected?.parser as Record<string, unknown> | null | undefined;
  const occurrence = selected?.occurrence as Record<string, unknown> | undefined;
  const table = (rows: [string, unknown][]) => <div className="diagnostic-table-wrap"><table className="diagnostic-table"><tbody>
    {rows.map(([key, value]) => <tr key={key}><th scope="row">{key}</th><td style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{display(value)}</td></tr>)}
  </tbody></table></div>;
  return <div className="diagnostic-sections">
    <p>{label('Recognition and progression eligibility are different. Plain vocabulary, unresolved analyses and partial parses do not become grammar targets.', 'పద గుర్తింపు, పురోగతి అర్హత వేర్వేరు. సాధారణ పదజాలం, అస్పష్ట లేదా పాక్షిక విశ్లేషణలు వ్యాకరణ లక్ష్యాలు కావు.')}</p>
    <button type="button" className="secondary-action" onClick={() => setRefresh(value => value + 1)}>{label('Refresh', 'మళ్లీ చూపించు')}</button>
    {error && <p role="alert" className="settings-error">{error}</p>}
    {!data && !error && <p role="status">...</p>}
    {data && !data.available && <p>{label('Build the grammar database to view the installed parser information.', 'పార్సర్ సమాచారం కోసం వ్యాకరణ డేటాబేస్‌ను నిర్మించండి.')}</p>}
    {data?.available && <section>
      <h3>{label('Catalog parser', 'డేటాబేస్ పార్సర్')}</h3>
      {table([
        [label('Selection active', 'ఎంపిక ప్రారంభమైంది'), data.active],
        [label('Parser version', 'పార్సర్ సంచిక'), data.parser?.version],
        [label('Eligibility adapter', 'అర్హత అడాప్టర్'), data.parser?.adapterVersion],
        [label('Target schema', 'లక్ష్య నిర్మాణం'), data.parser?.targetSchemaVersion],
        [label('Dictionary', 'నిఘంటువు'), data.parser?.dictionaryId],
        [label('Maximum search depth', 'గరిష్ఠ విశ్లేషణ లోతు'), data.parser?.maxDepth],
        [label('Maximum search states', 'గరిష్ఠ విశ్లేషణ స్థితులు'), data.parser?.maxStates],
        [label('Eligibility policy', 'అర్హత విధానం'), data.parser?.eligibilityPolicy],
        [label('Nesting', 'అనుసంధానం'), data.parser?.nesting],
        [label('Progression policy', 'పురోగతి విధానం'), data.policy],
        [label('Parser and rules fingerprint', 'పార్సర్ నియమాల గుర్తింపు'), data.rulesSha256],
        [label('Inventory', 'లక్ష్యాల జాబితా'), data.inventoryId],
        [label('Transcripts processed', 'విశ్లేషించిన పాఠాలు'), data.stats.observations],
        [label('Accepted word occurrences', 'ఆమోదించిన పద ప్రస్తావనలు'), data.stats.acceptedOccurrences],
        [label('Distinct words analyzed', 'విశ్లేషించిన వేర్వేరు పదాలు'), data.stats.words],
        [label('Distinct parsed words', 'గుర్తించిన వేర్వేరు పదాలు'), data.stats.parsedWords],
        [label('Distinct eligible words', 'అర్హతగల వేర్వేరు పదాలు'), data.stats.eligibleWords],
        [label('Plain vocabulary words', 'సాధారణ పదజాల పదాలు'), data.stats.plainVocabularyWords],
        [label('Progression units', 'పురోగతి లక్ష్యాలు'), data.stats.targets],
        [label('Eligible occurrences', 'అర్హతగల ప్రస్తావనలు'), data.stats.occurrences],
        [label('Exclusion counts by reason (distinct words)', 'కారణాలవారీగా మినహాయించిన పదాలు'), data.exclusions],
      ])}
    </section>}
    <section><h3>{label('Selected word analysis', 'ఎంచుకున్న పద విశ్లేషణ')}</h3>
      {!parsed ? <p>{label('No saved parser details for this observation. New grammar selections include them.', 'ఈ పరిశీలనకు భద్రపరచిన పార్సర్ వివరాలు లేవు. కొత్త వ్యాకరణ ఎంపికలలో ఉంటాయి.')}</p> : table([
        [label('Surface word', 'పద రూపం'), occurrence?.token_surface],
        [label('Status', 'స్థితి'), parsed.status], [label('Confidence', 'నమ్మకం'), parsed.confidence],
        [label('Eligible', 'అర్హత'), parsed.eligible], [label('Eligibility reason', 'అర్హత కారణం'), parsed.eligibilityReason || (parsed.eligible ? 'verified' : null)],
        [label('Parser version at selection', 'ఎంపిక సమయంలో పార్సర్ సంచిక'), parsed.version],
        [label('Rules fingerprint at selection', 'ఎంపిక సమయంలో నియమాల గుర్తింపు'), parsed.rulesSha256],
        [label('Parsed base (audit only)', 'విశ్లేషించిన మూల పదం'), parsed.baseId],
        [label('Base type', 'మూల పద రకం'), parsed.baseType],
        [label('Canonical modifier chain', 'ప్రామాణిక మార్పుల క్రమం'), parsed.chain],
        [label('Parser GI score', 'పార్సర్ GI విలువ'), parsed.giScore],
        [label('Selection category', 'ఎంపిక వర్గం'), selected?.categoryLevel],
        [label('Progression components', 'పురోగతి భాగాలు'), selected?.components],
        [label('Target identity', 'లక్ష్య గుర్తింపు'), selected?.targetId],
        [label('Analyses found', 'కనుగొన్న విశ్లేషణలు'), parsed.analysisCount],
        [label('Distinct best target identities', 'ఉత్తమ లక్ష్య గుర్తింపులు'), parsed.topTargetCount],
        [label('Normalization confidence', 'రూప సవరణ నమ్మకం'), parsed.normalizationConfidence],
        [label('Normalization operations', 'రూప సవరణలు'), parsed.normalizationOps],
        [label('Parser parts', 'పార్సర్ భాగాలు'), parsed.parts],
        [label('Search details', 'విశ్లేషణ వివరాలు'), parsed.search],
        [label('Unicode offsets [start, end)', 'యూనికోడ్ స్థానాలు [ప్రారంభం, ముగింపు)'), [occurrence?.start_cp, occurrence?.end_cp]],
      ])}
    </section>
  </div>;
}
