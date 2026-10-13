export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
export interface SavedDraft { content: string; revision: number }
/** One write at a time; newer edits are never marked saved by an older response. */
export class RepositoryDraft {
  value: string;
  revision: number;
  state: SaveState = 'saved';
  private saved: string;
  private pending: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(file: SavedDraft, private save: (draft: SavedDraft) => Promise<SavedDraft>,
    private persist: (draft: SavedDraft | null) => void, private changed: () => void,
    recovered?: SavedDraft | null) {
    this.value = this.saved = file.content; this.revision = file.revision;
    if (recovered && recovered.content !== file.content) {
      this.value = recovered.content;
      this.state = recovered.revision === file.revision ? 'dirty' : 'conflict';
    } else persist(null);
  }
  edit(value: string) {
    this.value = value;
    this.persist({content:value,revision:this.revision});
    if (this.state !== 'conflict') {
      this.state = 'dirty'; clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), 400);
    }
    this.changed();
  }
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.state === 'conflict') return Promise.resolve(false);
    if (this.pending) return this.pending;
    this.pending = this.run().finally(() => { this.pending = null; });
    return this.pending;
  }
  private async run(): Promise<boolean> {
    try {
      while (this.value !== this.saved) {
        this.state = 'saving'; this.changed();
        const sent = this.value;
        const result = await this.save({content:sent, revision:this.revision});
        this.saved = sent; this.revision = result.revision;
        this.persist(this.value === sent ? null : {content:this.value,revision:this.revision});
      }
      this.state = 'saved'; this.persist(null); this.changed(); return true;
    } catch (error) {
      this.state = ['stale-revision','not-found'].includes((error as {code?: string}).code ?? '') ? 'conflict' : 'error';
      this.changed(); return false;
    }
  }
  dispose() { clearTimeout(this.timer); }
}
export const draftKey = (profile: string, id: string) => `repository-draft:${profile}:${id}`;
export function recoverDraft(key: string): SavedDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return value && typeof value.content === 'string' && Number.isSafeInteger(value.revision) ? value : null;
  } catch { return null; }
}
