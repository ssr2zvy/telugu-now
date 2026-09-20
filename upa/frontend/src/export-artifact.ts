export type ExportFormat = 'html' | 'epub' | 'app-archive' | 'frequency-zip';
export interface PreparedExportArtifact {
  format: ExportFormat;
  blob: Blob;
  fileName: string;
  entryCount: number;
}
export function downloadPreparedExportArtifact(
  prepared: PreparedExportArtifact,
): void {
  const url = URL.createObjectURL(prepared.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = prepared.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
