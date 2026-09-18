import type {
  ProfileStateResponse,
} from '../../../../shared/contracts';
import {
  buildDiagnosticSections,
  diagnosticLabel,
  diagnosticSectionLabel,
  type DiagnosticSectionKey,
} from '../diagnostic';
import type {
  UiLanguage,
} from '../types';
interface DiagnosticPageProps {
  state: ProfileStateResponse;
  language: UiLanguage;
  fontFamily: string | null;
  sectionKey?: DiagnosticSectionKey;
}
export function DiagnosticPage({
  state,
  language,
  fontFamily,
  sectionKey,
}: DiagnosticPageProps) {
  const sections =
    buildDiagnosticSections(
      state,
      language,
      fontFamily,
    );
  if (!sections) {
    return (
      <div className="diagnostic-empty">
        {state.queue.preparationError
          ? `${state.queue.preparationError.code} (${state.queue.preparationError.attempts}/3). ${
            state.queue.preparationError.retryAt
              ? language === 'te' ? 'మళ్లీ ప్రయత్నిస్తుంది.' : 'Retry scheduled.'
              : language === 'te' ? 'సిద్ధీకరణ ఆగిపోయింది. మూల లభ్యతను తనిఖీ చేసి క్యూ రీసెట్ చేయండి.' : 'Preparation stopped. Check source availability and reset the queue to retry.'
          }`
          : '...'}
      </div>
    );
  }
  return (
    <div className="diagnostic-sections">
      {sections.filter((section) => !sectionKey || section.key === sectionKey).map(
        (section) => (
          <div
            key={section.key}
            className="diagnostic-section"
          >
            <h3 className="diagnostic-section-title">
              {diagnosticSectionLabel(
                language,
                section.key,
              )}
            </h3>
            <div className="diagnostic-table-wrap">
              <table className="diagnostic-table">
                <tbody>
                  {section.rows.map(
                    (row) => (
                      <tr key={row.key}>
                        <th scope="row">
                          {diagnosticLabel(
                            language,
                            row.key,
                          )}
                        </th>
                        <td>
                          {row.value}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
