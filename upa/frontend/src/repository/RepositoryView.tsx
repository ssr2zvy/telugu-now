import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CircleAlert, FolderInput, FileText, Folder, FolderOpen, LoaderCircle, MoreHorizontal, Pencil, Plus, RotateCw, Trash2, X } from 'lucide-react';
import type { RepositoryEntry, RepositoryFile, RepositoryKind } from '../../../shared/repository';
import { GradientBackdrop } from '../GradientBackdrop';
import { GoogleTeluguKeyboard } from '../observation/GoogleTeluguKeyboard';
import { repositoryApi } from './api';
import { RepositoryFileEditor } from './RepositoryFileEditor';

type Form = { action: 'create' | 'rename'; entry?: RepositoryEntry };
function EntryForm({ form, fontFamily, submit, close }: { form: Form; fontFamily: string;
  submit: (name: string, kind: RepositoryKind) => Promise<void>; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name,setName] = useState(form.entry?.name ?? '');
  const [kind,setKind] = useState<RepositoryKind>(form.entry?.kind ?? 'file');
  const [busy,setBusy] = useState(false); const [failed,setFailed] = useState(false);
  const pending = useRef(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); },[]);
  const save = async () => {
    if (pending.current || !name.trim()) return;
    pending.current = true; setBusy(true); setFailed(false);
    try { await submit(name,kind); } catch { setFailed(true); setBusy(false); pending.current = false; }
  };
  return <dialog ref={dialog} className="repository-entry-dialog" onCancel={event => { event.preventDefault(); if (!pending.current) close(); }} aria-label="పేరు">
    <div className="repository-form-actions">
      <button type="button" aria-label="మూయి" disabled={busy} onClick={close}><X/></button>
      {form.action === 'create' ? <div className="repository-kind">
        <button type="button" aria-label="పత్రం" aria-pressed={kind === 'file'} disabled={busy} onClick={() => setKind('file')}><FileText/></button>
        <button type="button" aria-label="సంచిక" aria-pressed={kind === 'folder'} disabled={busy} onClick={() => setKind('folder')}><Folder/></button>
      </div> : <Pencil aria-hidden="true"/>}
      <button type="button" aria-label="భద్రపరచు" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? <LoaderCircle className="repository-spin"/> : failed ? <RotateCw/> : <ArrowRight/>}</button>
    </div>
    <div inert={busy}><GoogleTeluguKeyboard value={name} onChange={setName} onSubmit={() => void save()} fontFamily={fontFamily} showCopy={false}/></div>
  </dialog>;
}
function DeleteConfirmation({ entry, remove, close }: { entry: RepositoryEntry; remove: () => Promise<void>; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const [busy,setBusy] = useState(false); const [failed,setFailed] = useState(false); const pending = useRef(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); },[]);
  return <dialog ref={dialog} className="repository-delete-dialog" aria-label="తొలగించు" onCancel={e => { e.preventDefault(); if (!pending.current) close(); }}>
    <div className="repository-delete-item">{entry.kind === 'folder' ? <Folder/> : <FileText/>}<span>{entry.name}</span></div>
    <div className="repository-delete-actions">
      <button type="button" aria-label="రద్దు" disabled={busy} onClick={close}><X/></button>
      <button type="button" aria-label="తొలగించు" disabled={busy} onClick={async () => {
        if (pending.current) return; pending.current = true; setBusy(true);
        try { await remove(); } catch { pending.current = false; setFailed(true); setBusy(false); }
      }}>{busy ? <LoaderCircle className="repository-spin"/> : failed ? <RotateCw/> : <Trash2/>}</button>
    </div>
  </dialog>;
}
export function RepositoryView({ profile, fontFamily, onClose }: { profile: string; fontFamily: string; onClose: () => void }) {
  const [path,setPath] = useState<RepositoryEntry[]>([]);
  const [entries,setEntries] = useState<RepositoryEntry[]>([]);
  const [file,setFile] = useState<RepositoryFile | null>(null);
  const [form,setForm] = useState<Form | null>(null);
  const [deletion,setDeletion] = useState<RepositoryEntry | null>(null);
  const [move,setMove] = useState<{entry: RepositoryEntry; origin: RepositoryEntry[]} | null>(null);
  const [moving,setMoving] = useState(false); const [moveFailed,setMoveFailed] = useState(false);
  const movePending = useRef(false);
  const [menu,setMenu] = useState<string | null>(null);
  const [loading,setLoading] = useState(true); const [failed,setFailed] = useState(false);
  const [refresh,setRefresh] = useState(0);
  const request = useRef(0); const opening = useRef(false);
  const parentId = path.at(-1)?.id ?? null;
  useEffect(() => {
    const token = ++request.current; let alive = true;
    setLoading(true); setFailed(false); setMenu(null); setMoveFailed(false);
    void repositoryApi.list(profile,parentId).then(result => { if (alive && token === request.current) setEntries(result); })
      .catch(() => { if (alive) setFailed(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  },[profile,parentId,refresh]);
  const reload = () => { setRefresh(n => n + 1); };
  const closeExplorer = () => {
    if (movePending.current) return;
    if (move) { setPath(move.origin); setMove(null); setMoveFailed(false); reload(); }
    else onClose();
  };
  const confirmMove = async () => {
    if (!move || movePending.current || loading || failed || parentId === move.entry.parentId) return;
    movePending.current = true; setMoving(true); setMoveFailed(false);
    try {
      await repositoryApi.update(profile,move.entry.id,{revision:move.entry.revision,parentId});
      setMove(null); reload();
    } catch { setMoveFailed(true); }
    finally { movePending.current = false; setMoving(false); }
  };
  if (file) return <RepositoryFileEditor key={file.id} profile={profile} file={file} fontFamily={fontFamily}
    onBack={() => { setFile(null); reload(); }} onClose={onClose}/>;
  return <section className="repository-screen" data-move-mode={Boolean(move)} aria-label="సంచికలు">
    <GradientBackdrop/>
    <header className="repository-toolbar">
      <nav className="repository-path" aria-label="దారి">
        <button type="button" aria-label="మూలం" disabled={moving} onClick={() => setPath([])}><FolderOpen/></button>
        {path.map((entry,index) => <button key={entry.id} type="button" disabled={moving} onClick={() => setPath(path.slice(0,index + 1))}>{entry.name}</button>)}
      </nav>
      {move ? <span className="repository-moving-item"><FolderInput aria-hidden="true"/><span>{move.entry.name}</span></span> : <button type="button" aria-label="కొత్తది" onClick={() => setForm({action:'create'})}><Plus/></button>}
      <button type="button" aria-label={move ? 'రద్దు' : 'మూయి'} disabled={moving} onClick={closeExplorer}><X/></button>
    </header>
    <div className="repository-list" onClick={() => setMenu(null)}>
      {path.length > 0 ? <div className="repository-row"><button type="button" className="repository-entry repository-parent" aria-label="పై సంచిక" disabled={moving} onClick={() => setPath(path.slice(0,-1))}><Folder aria-hidden="true"/><span>..</span></button></div> : null}
      {loading ? <LoaderCircle className="repository-spin repository-state" aria-label="వేచి ఉండు"/> : failed ? <button className="repository-state" type="button" aria-label="మళ్ళీ ప్రయత్నించు" onClick={reload}><RotateCw/></button> : entries.filter(entry => !move || (entry.kind === 'folder' && entry.id !== move.entry.id)).map(entry =>
        <div className="repository-row" key={entry.id}>
          <button type="button" className="repository-entry" disabled={moving} onClick={async () => {
            if (entry.kind === 'folder') { setPath([...path,entry]); return; }
            if (opening.current) return; opening.current = true;
            try { setFile(await repositoryApi.get(profile,entry.id)); } catch { setFailed(true); } finally { opening.current = false; }
          }}>{entry.kind === 'folder' ? <Folder/> : <FileText/>}<span>{entry.name}</span></button>
          {!move ? <button type="button" aria-label="చర్యలు" aria-expanded={menu === entry.id} onClick={e => { e.stopPropagation(); setMenu(menu === entry.id ? null : entry.id); }}><MoreHorizontal/></button> : null}
          {!move && menu === entry.id ? <div className="repository-row-actions">
            <button type="button" aria-label="పేరు మార్చు" onClick={() => setForm({action:'rename',entry})}><Pencil/></button>
            <button type="button" aria-label="తరలించు" onClick={() => { setMove({entry,origin:[...path]}); setMoveFailed(false); }}><FolderInput/></button>
            <button type="button" aria-label="తొలగించు" onClick={() => setDeletion(entry)}><Trash2/></button>
          </div> : null}
        </div>)}
    </div>
    {move ? <div className="repository-move-confirm">
      {moveFailed ? <CircleAlert role="img" aria-label="తరలించలేకపోయాము"/> : null}
      <button type="button" aria-label="ఇక్కడికి తరలించు" disabled={moving || loading || failed || parentId === move.entry.parentId} onClick={() => void confirmMove()}>{moving ? <LoaderCircle className="repository-spin"/> : <Check/>}</button>
    </div> : null}
    {form ? <EntryForm key={form.entry?.id ?? 'new'} form={form} fontFamily={fontFamily} close={() => setForm(null)} submit={async (name,kind) => {
      if (form.entry) await repositoryApi.update(profile,form.entry.id,{revision:form.entry.revision,name});
      else await repositoryApi.create(profile,parentId,kind,name);
      setForm(null); reload();
    }}/> : null}
    {deletion ? <DeleteConfirmation entry={deletion} close={() => setDeletion(null)} remove={async () => { await repositoryApi.remove(profile,deletion); setDeletion(null); reload(); }}/> : null}
  </section>;
}
