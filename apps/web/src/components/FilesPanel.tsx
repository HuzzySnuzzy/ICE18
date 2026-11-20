import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import type { FileEntry, ServerPermission, ServerSummary } from '@ice18/shared';
import { api, errorMessage } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';
import { Alert, Button, Dialog, Input, Spinner, cx } from './ui';

const EDITABLE_MAX_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS =
  /\.(ya?ml|json|properties|txt|log|toml|conf|cfg|ini|sh|bat|md|xml|js|ts|csv|lang|sk|mcfunction|mcmeta|env|html|css|py|lua|sql|secret|key|motd|list)$/i;
const ARCHIVE = /\.(zip|tar|tar\.gz|tgz|gz|tar\.bz2|tbz2|tar\.xz|txz|rar|7z)$/i;

const isText = (entry: FileEntry) =>
  entry.isFile &&
  (entry.mimetype.startsWith('text/') ||
    ['application/json', 'application/xml', 'inode/x-empty', 'application/x-yaml'].includes(entry.mimetype) ||
    TEXT_EXTENSIONS.test(entry.name) ||
    !entry.name.includes('.'));

const join = (directory: string, name: string) => `${directory.replace(/\/+$/, '')}/${name}`;

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-amber-300/80" fill="currentColor">
      <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.6l1.4 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M4 1.5h5.5L12.5 4.5v10H4z" />
      <path d="M9.5 1.5v3h3" />
    </svg>
  );
}

type Dialogs =
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'new-folder' }
  | { kind: 'new-file' }
  | { kind: 'delete'; entries: FileEntry[] }
  | null;

interface Editor {
  path: string;
  content: string;
  original: string;
  isNew: boolean;
  saving: boolean;
}

interface UploadState {
  name: string;
  progress: number;
  error?: string;
  done?: boolean;
}

export function FilesPanel({ server }: { server: ServerSummary }) {
  const identifier = server.identifier;
  const base = `/servers/${encodeURIComponent(identifier)}`;
  const can = (permission: ServerPermission) => server.permissions.includes(permission);
  const [searchParams, setSearchParams] = useSearchParams();
  const directory = searchParams.get('dir') || '/';

  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const go = useCallback(
    (dir: string) => {
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'files');
      if (dir === '/') next.delete('dir');
      else next.set('dir', dir);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await api<FileEntry[]>(`${base}/files?directory=${encodeURIComponent(directory)}`));
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [base, directory]);

  useEffect(() => {
    setEntries(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  if (!can('file.read')) return <Alert tone="yellow">You don't have permission to see this server's files.</Alert>;

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (success) setNotice(success);
      await load();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function open(entry: FileEntry) {
    if (!entry.isFile) return go(join(directory, entry.name));
    if (isText(entry) && entry.size <= EDITABLE_MAX_BYTES && can('file.read-content')) return edit(join(directory, entry.name));
    return download(entry);
  }

  async function edit(path: string) {
    setError(null);
    try {
      const { content } = await api<{ content: string }>(`${base}/files/contents?file=${encodeURIComponent(path)}`);
      setEditor({ path, content, original: content, isNew: false, saving: false });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function save() {
    if (!editor) return;
    setEditor({ ...editor, saving: true });
    try {
      await api(`${base}/files/contents`, { method: 'PUT', body: { file: editor.path, content: editor.content, create: editor.isNew } });
      setEditor({ ...editor, original: editor.content, isNew: false, saving: false });
      setNotice(`Saved ${editor.path}.`);
      void load();
    } catch (err) {
      setError(errorMessage(err));
      setEditor({ ...editor, saving: false });
    }
  }

  function closeEditor() {
    if (editor && editor.content !== editor.original && !window.confirm('Discard unsaved changes?')) return;
    setEditor(null);
  }

  async function download(entry: FileEntry) {
    try {
      const { url } = await api<{ url: string }>(`${base}/files/download?file=${encodeURIComponent(join(directory, entry.name))}`);
      window.location.assign(url);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = [...files];
    setUploads((current) => [...current.filter((item) => !item.done), ...list.map((file) => ({ name: file.name, progress: 0 }))]);
    const update = (name: string, patch: Partial<UploadState>) =>
      setUploads((current) => current.map((item) => (item.name === name && !item.done ? { ...item, ...patch } : item)));
    let remaining = list.length;
    for (const file of list) {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api${base}/files/upload?directory=${encodeURIComponent(directory)}&name=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader('x-ice18-csrf', '1');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (event) => event.lengthComputable && update(file.name, { progress: event.loaded / event.total });
      xhr.onloadend = () => {
        let message: string | undefined;
        if (xhr.status < 200 || xhr.status >= 300) {
          try {
            message = (JSON.parse(xhr.responseText) as { message?: string }).message;
          } catch {
            message = undefined;
          }
          message = message || `Upload failed (${xhr.status || 'network error'}).`;
        }
        update(file.name, { progress: 1, error: message, done: true });
        remaining -= 1;
        if (remaining === 0) void load();
      };
      xhr.send(file);
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  const crumbs = directory.split('/').filter(Boolean);
  const selectedEntries = (entries ?? []).filter((entry) => selected.has(entry.name));
  const allSelected = entries !== null && entries.length > 0 && selected.size === entries.length;
  const toggle = (name: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex w-full min-w-0 flex-wrap items-center gap-1 font-mono text-sm sm:w-auto sm:flex-1" aria-label="Folder">
          <button type="button" onClick={() => go('/')} className="rounded px-1.5 py-0.5 text-ice-400 hover:bg-ink-800" title="/home/container">
            <span className="sm:hidden">~</span>
            <span className="hidden sm:inline">/home/container</span>
          </button>
          {crumbs.map((part, index) => (
            <span key={index} className="flex items-center gap-1">
              <span className="text-ink-600">/</span>
              <button
                type="button"
                onClick={() => go(`/${crumbs.slice(0, index + 1).join('/')}`)}
                className={cx('rounded px-1.5 py-0.5 hover:bg-ink-800', index === crumbs.length - 1 ? 'text-ink-100' : 'text-ice-400')}
              >
                <span className="break-all">{part}</span>
              </button>
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          {can('file.create') && (
            <>
              <input ref={fileInput} type="file" multiple hidden onChange={(event) => upload(event.target.files)} />
              <Button variant="primary" onClick={() => fileInput.current?.click()}>
                Upload
              </Button>
              <Button onClick={() => setDialog({ kind: 'new-file' })}>New file</Button>
              <Button onClick={() => setDialog({ kind: 'new-folder' })}>New folder</Button>
            </>
          )}
          <Button variant="ghost" onClick={() => void load()} busy={loading} aria-label="Refresh">
            ↻
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ice-500/30 bg-ice-500/10 px-3 py-2 text-sm">
          <span className="text-ice-100">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {can('file.archive') && (
              <Button
                className="py-1"
                busy={busy}
                onClick={() =>
                  void run(
                    () => api(`${base}/files/compress`, { body: { root: directory, files: [...selected] } }),
                    `Archived ${selected.size} item${selected.size === 1 ? '' : 's'}.`,
                  )
                }
              >
                Archive
              </Button>
            )}
            {can('file.delete') && (
              <Button variant="danger" className="py-1" onClick={() => setDialog({ kind: 'delete', entries: selectedEntries })}>
                Delete
              </Button>
            )}
            <Button variant="ghost" className="py-1" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Alert>
          <div className="flex justify-between gap-3">
            <span>{error}</span>
            <button type="button" className="text-xs" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        </Alert>
      )}
      {notice && !error && (
        <Alert tone="ice">
          <div className="flex justify-between gap-3">
            <span>{notice}</span>
            <button type="button" className="text-xs" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      {uploads.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-ink-700 bg-ink-850 p-3 text-xs">
          {uploads.map((item, index) => (
            <div key={index} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate font-mono text-ink-200">{item.name}</span>
              {item.error ? (
                <span className="text-red-300">{item.error}</span>
              ) : item.done ? (
                <span className="text-emerald-300">Uploaded</span>
              ) : (
                <span className="h-1.5 w-28 overflow-hidden rounded-full bg-ink-700">
                  <span className="block h-full bg-ice-400 transition-all" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                </span>
              )}
            </div>
          ))}
          {uploads.every((item) => item.done) && (
            <button type="button" className="text-ink-400 hover:text-ink-200" onClick={() => setUploads([])}>
              Clear list
            </button>
          )}
        </div>
      )}

      {/* File list */}
      <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
        {entries === null ? (
          <div className="flex items-center gap-3 p-4 text-sm text-ink-400">
            <Spinner className="size-4" /> Loading…
          </div>
        ) : (
          <ul className="divide-y divide-ink-700/70">
            <li className="flex items-center gap-3 bg-ink-800/60 px-3 py-2 text-xs text-ink-400">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-ice-400)]"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(entries.map((entry) => entry.name)))}
                aria-label="Select all"
              />
              <span className="flex-1">Name</span>
              <span className="hidden w-24 text-right sm:block">Size</span>
              <span className="hidden w-40 text-right md:block">Modified</span>
              <span className="w-8" />
            </li>
            {directory !== '/' && (
              <li>
                <button
                  type="button"
                  onClick={() => go(`/${crumbs.slice(0, -1).join('/')}`)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-ink-300 hover:bg-ink-800"
                >
                  <span className="w-4" />
                  <FolderIcon />
                  ..
                </button>
              </li>
            )}
            {entries.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-400">This folder is empty.</li>}
            {entries.map((entry) => {
              const path = join(directory, entry.name);
              return (
                <li key={entry.name} className={cx('relative flex items-center gap-3 px-3 py-2 text-sm', selected.has(entry.name) ? 'bg-ice-500/10' : 'hover:bg-ink-800/60')}>
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-ice-400)]"
                    checked={selected.has(entry.name)}
                    onChange={() => toggle(entry.name)}
                    aria-label={`Select ${entry.name}`}
                  />
                  <button type="button" onClick={() => void open(entry)} className="flex min-w-0 flex-1 items-center gap-2.5 py-0.5 text-left">
                    {entry.isFile ? <FileIcon /> : <FolderIcon />}
                    <span className="truncate text-ink-100">{entry.name}</span>
                  </button>
                  <span className="hidden w-24 text-right text-xs text-ink-400 tabular-nums sm:block">{entry.isFile ? formatBytes(entry.size) : ''}</span>
                  <span className="hidden w-40 text-right text-xs text-ink-500 md:block">{entry.modifiedAt ? formatDate(entry.modifiedAt) : ''}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenu(menu === entry.name ? null : entry.name);
                    }}
                    className="w-8 rounded py-1 text-center text-ink-400 hover:bg-ink-700 hover:text-ink-100"
                    aria-label={`Actions for ${entry.name}`}
                  >
                    ⋯
                  </button>
                  {menu === entry.name && (
                    <div className="absolute top-full right-2 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-ink-600 bg-ink-800 py-1 text-sm shadow-xl" onClick={(event) => event.stopPropagation()}>
                      {[
                        entry.isFile && isText(entry) && can('file.read-content') && { label: 'Edit', run: () => void edit(path) },
                        entry.isFile && can('file.read-content') && { label: 'Download', run: () => void download(entry) },
                        can('file.update') && { label: 'Rename / move', run: () => setDialog({ kind: 'rename', entry }) },
                        entry.isFile &&
                          can('file.create') && {
                            label: 'Make a copy',
                            run: () => void run(() => api(`${base}/files/copy`, { body: { location: path } }), `Copied ${entry.name}.`),
                          },
                        entry.isFile &&
                          ARCHIVE.test(entry.name) &&
                          can('file.archive') && {
                            label: 'Unarchive here',
                            run: () =>
                              void run(() => api(`${base}/files/decompress`, { body: { root: directory, file: entry.name } }), `Unpacked ${entry.name}.`),
                          },
                        can('file.delete') && { label: 'Delete', danger: true, run: () => setDialog({ kind: 'delete', entries: [entry] }) },
                      ]
                        .filter((item): item is { label: string; run: () => void; danger?: boolean } => Boolean(item))
                        .map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => {
                              setMenu(null);
                              item.run();
                            }}
                            className={cx('block w-full px-3 py-2 text-left hover:bg-ink-700', item.danger ? 'text-red-300' : 'text-ink-100')}
                          >
                            {item.label}
                          </button>
                        ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Dialogs */}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          entries={dialog.entries}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const names = dialog.entries.map((entry) => entry.name);
            const ok = await run(
              () => api(`${base}/files/delete`, { body: { root: directory, files: names } }),
              `Deleted ${names.length} item${names.length === 1 ? '' : 's'}.`,
            );
            if (ok) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameDialog
          title={`Rename or move ${dialog.entry.name}`}
          label="New name (or a path like old/name to move it into a subfolder)"
          initial={dialog.entry.name}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (to) => {
            const ok = await run(() => api(`${base}/files/rename`, { body: { root: directory, from: dialog.entry.name, to } }), `Renamed to ${to}.`);
            if (ok) setDialog(null);
          }}
          allowPath
        />
      )}
      {dialog?.kind === 'new-folder' && (
        <NameDialog
          title="New folder"
          label="Folder name"
          initial=""
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const ok = await run(() => api(`${base}/files/folder`, { body: { root: directory, name } }), `Created ${name}.`);
            if (ok) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'new-file' && (
        <NameDialog
          title="New file"
          label="File name"
          initial=""
          busy={false}
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            setDialog(null);
            const path = join(directory, name);
            setEditor({ path, content: '', original: '', isNew: true, saving: false });
          }}
        />
      )}

      {editor && (
        <Dialog
          wide
          title={<span className="font-mono">{editor.path}</span>}
          onClose={closeEditor}
          footer={
            <>
              <span className="mr-auto self-center text-xs text-ink-400">
                {editor.content !== editor.original ? 'Unsaved changes · Ctrl+S to save' : editor.isNew ? 'New file' : 'Saved'}
              </span>
              <Button variant="ghost" onClick={closeEditor}>
                Close
              </Button>
              <Button
                variant="primary"
                busy={editor.saving}
                disabled={!can(editor.isNew ? 'file.create' : 'file.update') || (!editor.isNew && editor.content === editor.original)}
                onClick={() => void save()}
              >
                Save
              </Button>
            </>
          }
        >
          <textarea
            value={editor.content}
            onChange={(event) => setEditor({ ...editor, content: event.target.value })}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void save();
              }
              if (event.key === 'Tab') {
                event.preventDefault();
                const target = event.currentTarget;
                const { selectionStart, selectionEnd } = target;
                const next = `${editor.content.slice(0, selectionStart)}  ${editor.content.slice(selectionEnd)}`;
                setEditor({ ...editor, content: next });
                requestAnimationFrame(() => target.setSelectionRange(selectionStart + 2, selectionStart + 2));
              }
            }}
            spellCheck={false}
            readOnly={!can(editor.isNew ? 'file.create' : 'file.update')}
            className="h-[60dvh] w-full resize-none rounded-lg border border-ink-700 bg-ink-950 p-3 font-mono text-base leading-relaxed text-ink-100 focus:border-ice-500 focus:outline-none sm:text-[13px]"
          />
        </Dialog>
      )}
    </div>
  );
}

function DeleteDialog({
  entries,
  busy,
  onClose,
  onConfirm,
}: {
  entries: FileEntry[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const folders = entries.filter((entry) => !entry.isFile).length;
  return (
    <Dialog
      title={`Delete ${entries.length} item${entries.length === 1 ? '' : 's'}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} disabled={entries.length > 50} onClick={onConfirm}>
            Delete permanently
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-300">
        This permanently deletes {entries.length === 1 ? 'this item' : 'these items'} from the server.
        {folders > 0 && <b className="text-red-300"> Folders are deleted with everything inside them.</b>} It can't be undone.
      </p>
      {entries.length > 50 && <p className="mt-2 text-sm text-red-300">You can delete at most 50 items at a time.</p>}
      <ul className="mt-3 max-h-56 space-y-1 overflow-auto rounded-lg border border-ink-700 bg-ink-900 p-3 font-mono text-xs text-ink-200">
        {entries.map((entry) => (
          <li key={entry.name} className="flex items-center gap-2">
            {entry.isFile ? <FileIcon /> : <FolderIcon />} {entry.name}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function NameDialog({
  title,
  label,
  initial,
  busy,
  onClose,
  onSubmit,
  allowPath,
}: {
  title: string;
  label: string;
  initial: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  allowPath?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  const parts = trimmed.split('/');
  const valid =
    trimmed.length > 0 &&
    !trimmed.startsWith('/') &&
    parts.every((part) => part !== '' && part !== '.' && part !== '..') &&
    (allowPath || parts.length === 1);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) onSubmit(trimmed);
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Input label={label} value={value} onChange={(event) => setValue(event.target.value)} autoFocus spellCheck={false} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!valid}>
            OK
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
