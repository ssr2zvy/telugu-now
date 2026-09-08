import type {
  ProfileStateResponse,
} from '../../../../shared/contracts';
import {
  buildDiagnosticSections,
  diagnosticLabel,
  diagnosticSectionLabel,
} from '../diagnostic';
import type {
  UiLanguage,
} from '../types';
interface DiagnosticPageProps {
  state: ProfileStateResponse;
  language: UiLanguage;
}
export function DiagnosticPage({
  state,
  language,
}: DiagnosticPageProps) {
  const sections =
    buildDiagnosticSections(
      state,
      language,
    );
  if (!sections) {
    return (
      <div className="diagnostic-empty">
        ...
      </div>
    );
  }
  return (
    <div className="diagnostic-sections">
      {sections.map(
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
