import type {
  ProfileStateResponse,
} from '../../../../shared/contracts';
import {
  buildDiagnosticRows,
  diagnosticLabel,
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
  const rows =
    buildDiagnosticRows(
      state,
      language,
    );
  if (!rows) {
    return (
      <div className="diagnostic-empty">
        ...
      </div>
    );
  }
  return (
    <div className="diagnostic-table-wrap">
      <table className="diagnostic-table">
        <tbody>
          {rows.map(
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
  );
}
