import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type {
  DatabaseLockStatus,
  DatabaseUsage,
  DatabaseUsageIndex,
  DbCell,
  DbColumn,
  DbRowKey,
  DbRowsPage,
  DbTable,
  DbTableDesign,
  PanelDatabase,
} from '@ice18/shared';
import { api, errorMessage } from '../lib/api';
import { formatDate } from '../lib/format';
import { Alert, Badge, Button, Spinner, StateBadge, cx } from './ui';

const PAGE_SIZE = 100;

// ---------- small icons ----------

const Icon = {
  database: (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4">
      <ellipse cx="8" cy="3.5" rx="5.5" ry="2" />
      <path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
    </svg>
  ),
  table: (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <path d="M1.5 6h13M1.5 9.5h13M6 6v7.5M10.5 6v7.5" />
    </svg>
  ),
  view: (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" strokeDasharray="2 1.5" />
      <path d="M1.5 6h13M6 6v7.5" />
    </svg>
  ),
  key: (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-amber-300" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="5" cy="8" r="3" />
      <path d="M8 8h6.5M12 8v2.5M14.5 8v2" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="7" width="10" height="7" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  ),
  pencil: (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z" />
    </svg>
  ),
  chevron: (open: boolean) => (
    <svg viewBox="0 0 16 16" className={cx('size-3 shrink-0 transition-transform', open && 'rotate-90')} fill="currentColor">
      <path d="M6 4l4 4-4 4z" />
    </svg>
  ),
};

// ---------- helpers ----------

function cellText(cell: DbCell): string {
  if (cell === null) return '';
  if (typeof cell === 'object') return cell.hex ? `0x${cell.hex}` : `(binary, ${cell.binary.toLocaleString()} bytes)`;
  return cell;
}

function rowKey(design: DbTableDesign, columns: string[], row: DbCell[]): DbRowKey {
  const key: DbRowKey = {};
  for (const column of design.primaryKey) key[column] = row[columns.indexOf(column)] as string;
  return key;
}

interface OpenObject {
  id: string;
  serverIdentifier: string;
  databaseId: string;
  databaseName: string;
  /** Empty for the database's info tab. */
  table: string;
  type: 'table' | 'view' | 'info';
  view: 'datasheet' | 'design';
}

const databaseKey = (database: { serverIdentifier: string; id: string }) => `${database.serverIdentifier}/${database.id}`;

// ---------- ribbon ----------

function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center border-r border-ink-700 px-3 last:border-r-0">
      <div className="flex items-center gap-1">{children}</div>
      <div className="mt-1 text-[10px] tracking-wide text-ink-500 uppercase">{label}</div>
    </div>
  );
}

function RibbonButton({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        'flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-ice-500/20 text-ice-200' : 'text-ink-200 hover:bg-ink-700',
      )}
    >
      {children}
    </button>
  );
}

// ---------- design view ----------

function DesignView({ design }: { design: DbTableDesign }) {
  return (
    <div className="space-y-6 overflow-auto p-4">
      {design.readOnlyReason && <Alert tone="yellow">{design.readOnlyReason}</Alert>}
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="bg-ink-800 text-xs text-ink-300">
            <th className="w-6 border border-ink-700 px-2 py-1.5" />
            <th className="border border-ink-700 px-3 py-1.5 font-medium">Field Name</th>
            <th className="border border-ink-700 px-3 py-1.5 font-medium">Data Type</th>
            <th className="border border-ink-700 px-3 py-1.5 font-medium">Allow Null</th>
            <th className="border border-ink-700 px-3 py-1.5 font-medium">Default</th>
            <th className="border border-ink-700 px-3 py-1.5 font-medium">Extra</th>
          </tr>
        </thead>
        <tbody>
          {design.columns.map((column) => (
            <tr key={column.name} className="hover:bg-ink-800/60">
              <td className="border border-ink-700 px-2 py-1.5">{design.primaryKey.includes(column.name) && Icon.key}</td>
              <td className="border border-ink-700 px-3 py-1.5 font-mono text-ink-100">{column.name}</td>
              <td className="border border-ink-700 px-3 py-1.5 font-mono text-ink-300">{column.columnType}</td>
              <td className="border border-ink-700 px-3 py-1.5 text-ink-300">{column.nullable ? 'Yes' : 'No'}</td>
              <td className="border border-ink-700 px-3 py-1.5 font-mono text-ink-400">{column.default ?? ''}</td>
              <td className="border border-ink-700 px-3 py-1.5 text-ink-400">{column.extra}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-400 uppercase">Indexes</h3>
        {design.indexes.length === 0 ? (
          <p className="text-sm text-ink-500">None.</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <tbody>
              {design.indexes.map((index) => (
                <tr key={index.name}>
                  <td className="w-48 border border-ink-700 px-3 py-1.5 font-mono text-ink-100">{index.name}</td>
                  <td className="border border-ink-700 px-3 py-1.5 font-mono text-ink-300">{index.columns.join(', ')}</td>
                  <td className="w-28 border border-ink-700 px-3 py-1.5 text-ink-400">
                    {index.name === 'PRIMARY' ? 'Primary key' : index.unique ? 'Unique' : 'Index'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------- datasheet ----------

interface Editing {
  row: number;
  column: string;
  value: string;
  isNull: boolean;
}

interface DatasheetHandle {
  refresh: () => void;
  startNew: () => void;
  deleteSelected: () => void;
  selectedCount: number;
}

function Datasheet({
  base,
  design,
  locked,
  onStatus,
}: {
  base: string;
  design: DbTableDesign;
  locked: boolean;
  onStatus: (handle: DatasheetHandle) => void;
}) {
  const [page, setPage] = useState<DbRowsPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<{ column: string | null; dir: 'asc' | 'desc' }>({ column: null, dir: 'asc' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const editingRef = useRef<Editing | null>(null);
  editingRef.current = editing;

  const canEdit = !locked && design.editable;
  const columns = design.columns;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
      if (sort.column) {
        params.set('sort', sort.column);
        params.set('dir', sort.dir);
      }
      setPage(await api<DbRowsPage>(`${base}/rows?${params}`));
      setSelected(new Set());
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [base, offset, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  // The server came online: stop any edit in progress.
  useEffect(() => {
    if (locked) {
      setEditing(null);
      setDraft(null);
    }
  }, [locked]);

  async function commit(edit: Editing) {
    // Enter and blur can both fire for the same edit: only save once.
    if (!page || editingRef.current !== edit) return;
    editingRef.current = null;
    const original = page.rows[edit.row]?.[page.columns.indexOf(edit.column)];
    const next = edit.isNull ? null : edit.value;
    setEditing(null);
    if (original === next) return;
    setSaving(edit.row);
    setError(null);
    try {
      await api(`${base}/rows`, {
        method: 'PATCH',
        body: { key: rowKey(design, page.columns, page.rows[edit.row]!), values: { [edit.column]: next } },
      });
      setPage((current) => {
        if (!current) return current;
        const rows = current.rows.map((row, index) =>
          index === edit.row ? row.map((cell, col) => (current.columns[col] === edit.column ? next : cell)) : row,
        );
        return { ...current, rows };
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  async function saveNew() {
    if (!draft) return;
    setSaving('new');
    setError(null);
    try {
      const values: Record<string, string> = {};
      for (const [column, value] of Object.entries(draft)) if (value !== '') values[column] = value;
      await api(`${base}/rows`, { body: { values } });
      setDraft(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  async function deleteSelected() {
    if (!page || selected.size === 0) return;
    const count = selected.size;
    if (!window.confirm(`You are about to delete ${count} record${count === 1 ? '' : 's'}.\n\nThis can't be undone. Continue?`)) return;
    setError(null);
    try {
      const keys = [...selected].map((index) => rowKey(design, page.columns, page.rows[index]!));
      await api(`${base}/rows/delete`, { body: { keys } });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const startNew = () => {
    if (!canEdit) return;
    setDraft(Object.fromEntries(columns.filter((column) => column.editable).map((column) => [column.name, ''])));
    setCurrent(null);
  };

  // Let the ribbon drive the datasheet.
  const handleRef = useRef<DatasheetHandle | null>(null);
  handleRef.current = { refresh: () => void load(), startNew, deleteSelected: () => void deleteSelected(), selectedCount: selected.size };
  useEffect(() => {
    onStatus({
      refresh: () => handleRef.current?.refresh(),
      startNew: () => handleRef.current?.startNew(),
      deleteSelected: () => handleRef.current?.deleteSelected(),
      selectedCount: selected.size,
    });
  }, [onStatus, selected.size]);

  function beginEdit(rowIndex: number, column: DbColumn) {
    if (!canEdit || !column.editable || design.primaryKey.includes(column.name) || !page) return;
    const cell = page.rows[rowIndex]?.[page.columns.indexOf(column.name)];
    if (cell !== null && typeof cell === 'object') return;
    setEditing({ row: rowIndex, column: column.name, value: cell ?? '', isNull: cell === null });
    setCurrent(rowIndex);
  }

  function selectRow(index: number, event: MouseEvent) {
    setCurrent(index);
    setSelected((previous) => {
      if (event.shiftKey && current !== null) {
        const [from, to] = [Math.min(current, index), Math.max(current, index)];
        return new Set(Array.from({ length: to - from + 1 }, (_, offsetIndex) => from + offsetIndex));
      }
      if (event.metaKey || event.ctrlKey) {
        const next = new Set(previous);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      }
      return previous.size === 1 && previous.has(index) ? new Set() : new Set([index]);
    });
  }

  function onEditKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (editingRef.current) void commit(editingRef.current);
    } else if (event.key === 'Escape') {
      setEditing(null);
    }
  }

  const total = page?.total ?? null;
  const first = page && page.rows.length > 0 ? page.offset + 1 : 0;
  const last = page ? page.offset + page.rows.length : 0;
  const lastOffset = total !== null ? Math.max(0, Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE) : null;

  const header = useMemo(
    () =>
      columns.map((column) => {
        const active = (page?.sort ?? null) === column.name;
        return (
          <th
            key={column.name}
            onClick={() =>
              setSort((previous) => ({
                column: column.name,
                dir: previous.column === column.name && previous.dir === 'asc' ? 'desc' : 'asc',
              }))
            }
            title={`${column.columnType}${column.nullable ? ', nullable' : ''}. Click to sort.`}
            className="sticky top-0 z-10 cursor-pointer border border-ink-600 bg-ink-800 px-2 py-1.5 text-left text-xs font-semibold whitespace-nowrap text-ink-200 select-none hover:bg-ink-700"
          >
            <span className="flex items-center gap-1.5">
              {design.primaryKey.includes(column.name) && Icon.key}
              {column.name}
              {active && <span className="text-ice-300">{page?.dir === 'desc' ? '▼' : '▲'}</span>}
            </span>
          </th>
        );
      }),
    [columns, design.primaryKey, page?.sort, page?.dir],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <div className="flex items-start justify-between gap-3 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <span>{error}</span>
          <button type="button" className="text-xs text-red-300 hover:text-red-100" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {design.readOnlyReason && !locked && (
        <div className="border-b border-ink-700 bg-ink-800/60 px-3 py-1.5 text-xs text-ink-300">{design.readOnlyReason}</div>
      )}

      <div className="relative min-h-0 flex-1 overflow-auto">
        {!page ? (
          <div className="flex items-center gap-3 p-4 text-sm text-ink-400">
            <Spinner className="size-4" /> Loading records…
          </div>
        ) : (
          <table className="border-collapse font-mono text-[13px]">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 w-7 border border-ink-600 bg-ink-800" />
                {header}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row, rowIndex) => {
                const isSelected = selected.has(rowIndex);
                const isCurrent = current === rowIndex;
                return (
                  <tr key={rowIndex} className={cx(isSelected ? 'bg-ice-500/15' : rowIndex % 2 ? 'bg-ink-900/40' : '', 'hover:bg-ink-800/70')}>
                    <td
                      onClick={(event) => selectRow(rowIndex, event)}
                      className={cx(
                        'sticky left-0 z-10 w-7 cursor-pointer border border-ink-600 text-center text-[10px] text-ink-400 select-none',
                        isSelected ? 'bg-ice-500/30 text-ice-100' : 'bg-ink-800 hover:bg-ink-700',
                      )}
                      title="Select record (Ctrl/Shift for several)"
                    >
                      {saving === rowIndex ? (
                        <Spinner className="size-3" />
                      ) : editing?.row === rowIndex ? (
                        <span className="text-ice-300">{Icon.pencil}</span>
                      ) : isCurrent ? (
                        '▶'
                      ) : (
                        ''
                      )}
                    </td>
                    {columns.map((column, columnIndex) => {
                      const cell = row[page.columns.indexOf(column.name)] ?? null;
                      const isEditing = editing?.row === rowIndex && editing.column === column.name;
                      const editable = canEdit && column.editable && !design.primaryKey.includes(column.name);
                      return (
                        <td
                          key={column.name}
                          onClick={() => setCurrent(rowIndex)}
                          onDoubleClick={() => beginEdit(rowIndex, column)}
                          className={cx(
                            'max-w-[22rem] border border-ink-700 px-2 py-1 align-top whitespace-nowrap',
                            isEditing ? 'p-0 outline-2 -outline-offset-2 outline-ice-400' : 'truncate',
                            editable && !isEditing && 'cursor-text',
                          )}
                          title={isEditing ? undefined : cellText(cell)}
                          data-col={columnIndex}
                        >
                          {isEditing ? (
                            <span className="flex items-center">
                              <input
                                autoFocus
                                value={editing.isNull ? '' : editing.value}
                                placeholder={editing.isNull ? '(null)' : ''}
                                onChange={(event) => setEditing({ ...editing, value: event.target.value, isNull: false })}
                                onKeyDown={onEditKey}
                                onBlur={() => editingRef.current && void commit(editingRef.current)}
                                className="min-w-[10rem] flex-1 bg-ink-950 px-2 py-1 text-ink-100 outline-none"
                              />
                              {column.nullable && (
                                <button
                                  type="button"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => setEditing({ ...editing, isNull: true, value: '' })}
                                  className={cx('px-1.5 text-[10px] font-sans', editing.isNull ? 'text-ice-300' : 'text-ink-400 hover:text-ink-200')}
                                  title="Set to NULL"
                                >
                                  NULL
                                </button>
                              )}
                            </span>
                          ) : cell === null ? (
                            <span className="text-ink-500 italic">(null)</span>
                          ) : typeof cell === 'object' ? (
                            <span className="text-ink-400">{cellText(cell)}</span>
                          ) : (
                            <span className="text-ink-100">{cell}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {draft ? (
                <tr className="bg-ice-500/5">
                  <td className="sticky left-0 z-10 border border-ink-600 bg-ink-800 text-center text-ice-300">
                    {saving === 'new' ? <Spinner className="size-3" /> : Icon.pencil}
                  </td>
                  {columns.map((column) => (
                    <td key={column.name} className="border border-ink-700 p-0">
                      {column.editable ? (
                        <input
                          value={draft[column.name] ?? ''}
                          onChange={(event) => setDraft({ ...draft, [column.name]: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveNew();
                            if (event.key === 'Escape') setDraft(null);
                          }}
                          placeholder={column.autoIncrement ? '(New)' : column.default !== null ? `default: ${column.default}` : ''}
                          className="w-full min-w-[8rem] bg-transparent px-2 py-1 text-ink-100 outline-none placeholder:text-ink-500 focus:bg-ink-950"
                        />
                      ) : (
                        <span className="px-2 text-ink-500">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ) : (
                canEdit && (
                  <tr>
                    <td
                      onClick={startNew}
                      className="sticky left-0 z-10 cursor-pointer border border-ink-600 bg-ink-800 text-center text-ink-300 hover:bg-ink-700"
                      title="New record"
                    >
                      *
                    </td>
                    <td colSpan={columns.length} className="border border-ink-700 px-2 py-1 text-ink-500">
                      <button type="button" onClick={startNew} className="font-sans text-xs hover:text-ink-300">
                        Click to add a new record
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </div>

      {draft && (
        <div className="flex items-center gap-2 border-t border-ink-700 bg-ink-850 px-3 py-2">
          <span className="text-xs text-ink-400">New record: leave a field empty to use its default.</span>
          <Button variant="primary" className="ml-auto py-1" onClick={() => void saveNew()} busy={saving === 'new'}>
            Save record
          </Button>
          <Button variant="ghost" className="py-1" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      )}

      {/* Record navigation bar, Access style. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-300">
        <span className="text-ink-400">Records:</span>
        <NavButton label="First page" disabled={offset === 0} onClick={() => setOffset(0)}>
          ⏮
        </NavButton>
        <NavButton label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          ◀
        </NavButton>
        <span className="min-w-[9rem] text-center tabular-nums">
          {page ? (
            <>
              {first.toLocaleString()}–{last.toLocaleString()} of {total === null ? '?' : `${page.totalIsEstimate ? '~' : ''}${total.toLocaleString()}`}
            </>
          ) : (
            '…'
          )}
        </span>
        <NavButton
          label="Next page"
          disabled={!page || page.rows.length < PAGE_SIZE || (total !== null && last >= total)}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          ▶
        </NavButton>
        <NavButton
          label="Last page"
          disabled={lastOffset === null || offset >= lastOffset}
          onClick={() => lastOffset !== null && setOffset(lastOffset)}
        >
          ⏭
        </NavButton>
        {canEdit && (
          <NavButton label="New record" onClick={startNew}>
            ▶*
          </NavButton>
        )}
        {loading && page && <Spinner className="ml-1 size-3" />}
        <span className="ml-auto text-ink-500">
          {selected.size > 0 ? `${selected.size} selected · ` : ''}
          {canEdit ? 'Double-click a cell to edit · Enter saves · Esc cancels' : locked ? 'Read-only while a server using this database is online' : ''}
        </span>
      </div>
    </div>
  );
}

function NavButton({ children, onClick, disabled, label }: { children: ReactNode; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded px-1.5 py-0.5 text-ink-200 hover:bg-ink-700 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

// ---------- object (open tab) ----------

function ObjectView({
  object,
  locked,
  onStatus,
}: {
  object: OpenObject;
  locked: boolean;
  onStatus: (handle: DatasheetHandle | null, design: DbTableDesign | null) => void;
}) {
  const base = `/servers/${encodeURIComponent(object.serverIdentifier)}/db/${encodeURIComponent(object.databaseId)}/tables/${encodeURIComponent(object.table)}`;
  const [design, setDesign] = useState<DbTableDesign | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDesign(null);
    setError(null);
    api<DbTableDesign>(base)
      .then(setDesign)
      .catch((err) => setError(errorMessage(err)));
  }, [base]);

  const report = useCallback((handle: DatasheetHandle) => onStatus(handle, design), [onStatus, design]);
  useEffect(() => {
    if (object.view === 'design') onStatus(null, design);
  }, [object.view, design, onStatus]);

  if (error) {
    return (
      <div className="p-4">
        <Alert>{error}</Alert>
      </div>
    );
  }
  if (!design) {
    return (
      <div className="flex items-center gap-3 p-4 text-sm text-ink-400">
        <Spinner className="size-4" /> Opening {object.table}…
      </div>
    );
  }
  return object.view === 'design' ? <DesignView design={design} /> : <Datasheet base={base} design={design} locked={locked} onStatus={report} />;
}

// ---------- database info ----------

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-400">{label}</dt>
      <dd className="min-w-0 break-words text-ink-100">{children}</dd>
    </>
  );
}

function DatabaseInfo({
  database,
  usages,
  usageLoading,
  status,
}: {
  database: PanelDatabase;
  usages: DatabaseUsage[];
  usageLoading: boolean;
  status: DatabaseLockStatus | undefined;
}) {
  return (
    <div className="space-y-6 overflow-auto p-5">
      <section>
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-ink-400 uppercase">Where it lives</h3>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[150px_1fr]">
          <Property label="Database">
            <span className="font-mono">{database.name}</span>
          </Property>
          <Property label="Owner server">
            <Link to={`/servers/${database.serverIdentifier}`} className="text-ice-400 hover:text-ice-300">
              {database.serverName}
            </Link>{' '}
            <span className="text-xs text-ink-500">(its Databases tab in Pterodactyl)</span>
          </Property>
          <Property label="Host">
            <span className="font-mono">
              {database.pluginHost}:{database.port}
            </span>
            {database.pluginHost !== database.host && (
              <span className="text-xs text-ink-500"> (Pterodactyl lists {database.host}; servers connect via {database.pluginHost})</span>
            )}
          </Property>
          <Property label="Username">
            <span className="font-mono">{database.username}</span>
          </Property>
          <Property label="Connections from">
            <span className="font-mono">{database.connectionsFrom}</span>
          </Property>
        </dl>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-ink-400 uppercase">Used by</h3>
        {usageLoading && usages.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-ink-400">
            <Spinner className="size-3.5" /> Scanning plugin configs on your servers…
          </div>
        ) : usages.length === 0 ? (
          <p className="text-sm text-ink-400">
            No plugin ICE18 knows about points at this database. Plugins ICE18 has no recipe for aren't detected.
          </p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-ink-800 text-xs text-ink-300">
                <th className="border border-ink-700 px-3 py-1.5 font-medium">Server</th>
                <th className="border border-ink-700 px-3 py-1.5 font-medium">Plugin</th>
                <th className="border border-ink-700 px-3 py-1.5 font-medium">Config file</th>
              </tr>
            </thead>
            <tbody>
              {usages.map((usage, index) => (
                <tr key={index}>
                  <td className="border border-ink-700 px-3 py-1.5">
                    {usage.serverIdentifier ? (
                      <Link to={`/servers/${usage.serverIdentifier}?tab=plugins`} className="text-ice-400 hover:text-ice-300">
                        {usage.serverName}
                      </Link>
                    ) : (
                      <span className="text-ink-400 italic">{usage.serverName}</span>
                    )}
                  </td>
                  <td className="border border-ink-700 px-3 py-1.5 text-ink-100">{usage.plugin}</td>
                  <td className="border border-ink-700 px-3 py-1.5 font-mono text-xs text-ink-300">{usage.configFile ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-ink-400 uppercase">Lock</h3>
        {!status ? (
          <Spinner className="size-4" />
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-300">
              {status.locked
                ? 'Read-only: the owner server or a server whose plugins use this database is online.'
                : 'Every server that uses this database is offline, so it can be edited.'}
            </p>
            <ul className="space-y-1.5 text-sm">
              {status.servers.map((server, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2">
                  <StateBadge state={server.state} />
                  <span className="text-ink-100">{server.name}</span>
                  <span className="text-xs text-ink-500">
                    {server.role === 'owner' ? 'owner' : ''}
                    {server.role === 'owner' && server.plugins.length > 0 ? ' · ' : ''}
                    {server.plugins.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

// ---------- navigation pane ----------

function NavigationPane({
  databases,
  usage,
  isAdmin,
  expanded,
  setExpanded,
  onOpen,
  activeId,
}: {
  databases: PanelDatabase[];
  usage: DatabaseUsageIndex | null;
  isAdmin: boolean;
  expanded: Record<string, boolean>;
  setExpanded: (update: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  onOpen: (database: PanelDatabase, table?: DbTable) => void;
  activeId: string | null;
}) {
  const [tables, setTables] = useState<Record<string, DbTable[] | string>>({});
  const [filter, setFilter] = useState('');

  const loadTables = useCallback(async (database: PanelDatabase, refresh = false) => {
    const key = databaseKey(database);
    try {
      const list = await api<DbTable[]>(
        `/servers/${encodeURIComponent(database.serverIdentifier)}/db/${encodeURIComponent(database.id)}/tables${refresh ? '?refresh=1' : ''}`,
      );
      setTables((current) => ({ ...current, [key]: list }));
    } catch (err) {
      setTables((current) => ({ ...current, [key]: errorMessage(err) }));
    }
  }, []);

  useEffect(() => {
    for (const database of databases) {
      const key = databaseKey(database);
      if (expanded[key] && database.canBrowse && tables[key] === undefined) void loadTables(database);
    }
  }, [databases, expanded, tables, loadTables]);

  const needle = filter.trim().toLowerCase();
  const usageFor = (name: string) => usage?.usages.filter((entry) => entry.databaseName === name) ?? [];
  const matches = (database: PanelDatabase) => {
    if (!needle) return true;
    const list = tables[databaseKey(database)];
    return [
      database.name,
      database.serverName,
      ...usageFor(database.name).flatMap((entry) => [entry.serverName, entry.plugin]),
      ...(Array.isArray(list) ? list.map((table) => table.name) : []),
    ].some((value) => value.toLowerCase().includes(needle));
  };

  const hosts = new Map<string, PanelDatabase[]>();
  for (const database of databases.filter(matches)) {
    const host = `${database.pluginHost}:${database.port}`;
    hosts.set(host, [...(hosts.get(host) ?? []), database]);
  }
  const unmanaged = (usage?.unmanaged ?? []).filter(
    (entry) => !needle || entry.databaseName.toLowerCase().includes(needle) || usageFor(entry.databaseName).some((u) => u.serverName.toLowerCase().includes(needle)),
  );

  return (
    <aside className="flex max-h-80 min-h-0 flex-col border-b border-ink-700 bg-ink-900 md:max-h-none md:w-72 md:shrink-0 md:border-r md:border-b-0">
      <div className="border-b border-ink-700 px-3 py-2">
        <div className="text-xs font-semibold tracking-wide text-ink-300 uppercase">All Databases</div>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search databases, servers, plugins…"
          className="mt-2 w-full rounded border border-ink-600 bg-ink-950 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-500 focus:border-ice-500 focus:outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1 text-sm">
        {databases.length === 0 && (
          <p className="px-3 py-2 text-xs text-ink-400">
            No databases yet. Create one from a server's <b>Plugins &amp; databases</b> tab.
          </p>
        )}
        {[...hosts.entries()].map(([host, list]) => (
          <div key={host} className="mb-1">
            <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-ink-500 uppercase" title="Database host">
              <span className="font-mono normal-case">{host}</span>
            </div>
            {list.map((database) => {
              const key = databaseKey(database);
              const open = expanded[key] ?? false;
              const tableList = tables[key];
              const users = usageFor(database.name);
              const otherServers = new Set(users.filter((entry) => entry.serverIdentifier !== database.serverIdentifier).map((entry) => entry.serverName));
              const visibleTables = Array.isArray(tableList)
                ? tableList.filter((table) => !needle || table.name.toLowerCase().includes(needle) || matches(database))
                : [];
              return (
                <div key={key}>
                  <div
                    className={cx(
                      'flex w-full items-start gap-1 px-2 py-1 hover:bg-ink-800',
                      activeId === `${key}/` && 'bg-ice-500/15',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setExpanded((current) => ({ ...current, [key]: !open }))}
                      className="mt-0.5 rounded p-0.5 text-ink-400 hover:text-ink-100 disabled:opacity-30"
                      aria-label={open ? 'Collapse' : 'Expand'}
                      disabled={!database.canBrowse}
                    >
                      {Icon.chevron(open)}
                    </button>
                    <button type="button" onClick={() => onOpen(database)} className="flex min-w-0 flex-1 items-start gap-1.5 text-left">
                      <span className="mt-0.5 text-ice-300">{Icon.database}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs text-ink-100">{database.name}</span>
                        <span className="block truncate text-[11px] text-ink-500">
                          {database.serverName}
                          {otherServers.size > 0 && ` · also used by ${otherServers.size} other server${otherServers.size === 1 ? '' : 's'}`}
                        </span>
                      </span>
                    </button>
                  </div>
                  {open && (
                    <div className="pb-1">
                      {tableList === undefined && (
                        <div className="flex items-center gap-2 py-1 pl-10 text-xs text-ink-400">
                          <Spinner className="size-3" /> Loading…
                        </div>
                      )}
                      {typeof tableList === 'string' && (
                        <div className="px-3 py-1 pl-10 text-xs text-red-300">
                          {tableList}{' '}
                          <button type="button" className="text-ice-400 underline" onClick={() => void loadTables(database, true)}>
                            Retry
                          </button>
                        </div>
                      )}
                      {(['table', 'view'] as const).map((type) => {
                        const items = visibleTables.filter((table) => table.type === type);
                        if (items.length === 0) return null;
                        return (
                          <div key={type}>
                            <div className="py-0.5 pl-10 text-[10px] tracking-wide text-ink-500 uppercase">{type === 'table' ? 'Tables' : 'Views'}</div>
                            {items.map((table) => (
                              <button
                                key={table.name}
                                type="button"
                                onClick={() => onOpen(database, table)}
                                className={cx(
                                  'flex w-full items-center gap-1.5 py-0.5 pr-2 pl-10 text-left text-xs',
                                  activeId === `${key}/${table.name}` ? 'bg-ice-500/20 text-ice-100' : 'text-ink-200 hover:bg-ink-800',
                                )}
                                title={table.comment || table.name}
                              >
                                <span className="text-ink-400">{type === 'view' ? Icon.view : Icon.table}</span>
                                <span className="truncate">{table.name}</span>
                                {table.rows !== null && (
                                  <span className="ml-auto pl-2 text-[10px] text-ink-500 tabular-nums">{table.rows.toLocaleString()}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                      {Array.isArray(tableList) && tableList.length === 0 && <div className="py-1 pl-10 text-xs text-ink-500">No tables yet.</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {isAdmin && unmanaged.length > 0 && (
          <div className="mt-2 border-t border-ink-700 pt-1">
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-ink-500 uppercase" title="Plugins point at these, but Pterodactyl doesn't manage them">
              Not managed by Pterodactyl
            </div>
            {unmanaged.map((entry) => {
              const users = usageFor(entry.databaseName);
              return (
                <div key={`${entry.databaseName}@${entry.host}`} className="px-3 py-1" title={users.map((u) => `${u.serverName}: ${u.plugin}`).join('\n')}>
                  <div className="flex items-center gap-1.5 text-ink-300">
                    <span className="text-ink-500">{Icon.database}</span>
                    <span className="truncate font-mono text-xs">{entry.databaseName}</span>
                  </div>
                  <div className="truncate pl-5.5 text-[11px] text-ink-500">
                    {entry.host ?? '?'} · used by {[...new Set(users.map((u) => u.serverName))].join(', ')}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {usage && (
        <div className="border-t border-ink-700 px-3 py-1.5 text-[10px] text-ink-500">
          Plugin usage scanned {formatDate(usage.scannedAt)}
          {usage.failedServers > 0 && ` · ${usage.failedServers} server(s) couldn't be scanned`}
        </div>
      )}
    </aside>
  );
}

// ---------- explorer ----------

export function DatabaseExplorer({ isAdmin }: { isAdmin: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [databases, setDatabases] = useState<PanelDatabase[] | null>(null);
  const [usage, setUsage] = useState<DatabaseUsageIndex | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenObject[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [statuses, setStatuses] = useState<Record<string, DatabaseLockStatus>>({});
  const [sheet, setSheet] = useState<{ handle: DatasheetHandle | null; design: DbTableDesign | null }>({ handle: null, design: null });
  const [stopping, setStopping] = useState<string | null>(null);

  const loadUsage = useCallback(async (refresh = false) => {
    setUsageLoading(true);
    try {
      setUsage(await api<DatabaseUsageIndex>(`/databases/usage${refresh ? '?refresh=1' : ''}`));
    } catch {
      /* usage is a nice-to-have */
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    api<PanelDatabase[]>('/databases')
      .then(setDatabases)
      .catch((err) => setError(errorMessage(err)));
    void loadUsage();
  }, [loadUsage]);

  const active = open.find((object) => object.id === activeId) ?? null;
  const activeDatabase = active ? databases?.find((database) => databaseKey(database) === `${active.serverIdentifier}/${active.databaseId}`) : undefined;
  const activeKey = activeDatabase ? databaseKey(activeDatabase) : null;
  const status = activeKey ? statuses[activeKey] : undefined;
  // Until we know, treat data as locked.
  const locked = status ? status.locked : true;

  const refreshStatus = useCallback(async (database: PanelDatabase) => {
    try {
      const next = await api<DatabaseLockStatus>(
        `/servers/${encodeURIComponent(database.serverIdentifier)}/db/${encodeURIComponent(database.id)}/status`,
      );
      setStatuses((current) => ({ ...current, [databaseKey(database)]: next }));
    } catch {
      /* keep the last known status */
    }
  }, []);

  // Keep the active database's lock up to date.
  useEffect(() => {
    if (!activeDatabase?.canBrowse) return;
    void refreshStatus(activeDatabase);
    const timer = window.setInterval(() => void refreshStatus(activeDatabase), 10_000);
    return () => window.clearInterval(timer);
  }, [activeDatabase, refreshStatus]);

  const onStatus = useCallback((handle: DatasheetHandle | null, design: DbTableDesign | null) => setSheet({ handle, design }), []);

  const openDatabase = useCallback((database: PanelDatabase, table?: DbTable) => {
    const key = databaseKey(database);
    const id = `${key}/${table?.name ?? ''}`;
    setOpen((current) =>
      current.some((entry) => entry.id === id)
        ? current
        : [
            ...current,
            {
              id,
              serverIdentifier: database.serverIdentifier,
              databaseId: database.id,
              databaseName: database.name,
              table: table?.name ?? '',
              type: table?.type ?? 'info',
              view: 'datasheet',
            },
          ],
    );
    setActiveId(id);
    if (database.canBrowse) setExpanded((current) => ({ ...current, [key]: true }));
  }, []);

  // Deep link: /databases?db=<server>/<databaseId>
  useEffect(() => {
    const target = searchParams.get('db');
    if (!target || !databases) return;
    const database = databases.find((entry) => databaseKey(entry) === target);
    if (database) openDatabase(database);
    setSearchParams({}, { replace: true });
  }, [searchParams, databases, openDatabase, setSearchParams]);

  function closeObject(id: string) {
    setOpen((current) => {
      const index = current.findIndex((entry) => entry.id === id);
      const next = current.filter((entry) => entry.id !== id);
      if (activeId === id) setActiveId(next[Math.max(0, index - 1)]?.id ?? null);
      return next;
    });
  }

  function setView(view: OpenObject['view']) {
    if (!active) return;
    setOpen((current) => current.map((entry) => (entry.id === active.id ? { ...entry, view } : entry)));
  }

  async function stopServer(identifier: string) {
    if (!window.confirm('Stop this server so the database can be edited?')) return;
    setStopping(identifier);
    try {
      await api(`/servers/${encodeURIComponent(identifier)}/power`, { body: { signal: 'stop' } });
      if (activeDatabase) window.setTimeout(() => void refreshStatus(activeDatabase), 3000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStopping(null);
    }
  }

  if (error && !databases) return <Alert>{error}</Alert>;
  if (!databases) {
    return (
      <div className="flex items-center gap-3 text-sm text-ink-400">
        <Spinner className="size-4" /> Loading databases…
      </div>
    );
  }

  const isTable = active && active.type !== 'info';
  const canChangeRows = Boolean(isTable && active.view === 'datasheet' && sheet.design?.editable && !locked);
  const onlineServers = status?.servers.filter((server) => server.state !== 'offline') ?? [];

  return (
    <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-950">
      {error && (
        <div className="flex justify-between gap-3 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <span>{error}</span>
          <button type="button" className="text-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {/* Ribbon */}
      <div className="flex flex-wrap items-stretch gap-y-2 border-b border-ink-700 bg-ink-850 px-1 py-2">
        <RibbonGroup label="Views">
          <RibbonButton active={isTable ? active.view === 'datasheet' : false} disabled={!isTable} onClick={() => setView('datasheet')} title="Datasheet View">
            {Icon.table} Datasheet
          </RibbonButton>
          <RibbonButton active={isTable ? active.view === 'design' : false} disabled={!isTable} onClick={() => setView('design')} title="Design View">
            {Icon.key} Design
          </RibbonButton>
        </RibbonGroup>
        <RibbonGroup label="Records">
          <RibbonButton disabled={!isTable || active.view !== 'datasheet'} onClick={() => sheet.handle?.refresh()} title="Refresh">
            ↻ Refresh
          </RibbonButton>
          <RibbonButton disabled={!canChangeRows} onClick={() => sheet.handle?.startNew()} title="New record">
            ＋ New
          </RibbonButton>
          <RibbonButton
            disabled={!canChangeRows || !sheet.handle || sheet.handle.selectedCount === 0}
            onClick={() => sheet.handle?.deleteSelected()}
            title="Delete selected records"
          >
            ✕ Delete
          </RibbonButton>
        </RibbonGroup>
        <RibbonGroup label="Usage">
          <RibbonButton onClick={() => void loadUsage(true)} disabled={usageLoading} title="Scan plugin configs on all servers again">
            {usageLoading ? <Spinner className="size-3" /> : '⟳'} Rescan
          </RibbonButton>
        </RibbonGroup>
        {activeDatabase && (
          <div className="ml-auto flex flex-wrap items-center gap-2 px-3">
            {!status ? (
              <span className="flex items-center gap-1.5 text-xs text-ink-400">
                <Spinner className="size-3" /> Checking servers…
              </span>
            ) : locked ? (
              <>
                <span
                  className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-200"
                  title={onlineServers.map((server) => `${server.name}: ${server.state}`).join('\n')}
                >
                  {Icon.lock} Read-only · {onlineServers.length === 1 ? `${onlineServers[0]!.name} is ${onlineServers[0]!.state}` : `${onlineServers.length} servers online`}
                </span>
                {onlineServers
                  .filter((server) => server.canStop && server.identifier && server.state === 'running')
                  .map((server) => (
                    <Button key={server.identifier} variant="secondary" className="py-1 text-xs" busy={stopping === server.identifier} onClick={() => void stopServer(server.identifier!)}>
                      Stop {server.name}
                    </Button>
                  ))}
              </>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-200">
                {Icon.pencil} Editing enabled · all {status.servers.length} server{status.servers.length === 1 ? '' : 's'} offline
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col md:h-[calc(100vh-15rem)] md:min-h-[560px] md:flex-row">
        <NavigationPane
          databases={databases}
          usage={usage}
          isAdmin={isAdmin}
          expanded={expanded}
          setExpanded={setExpanded}
          onOpen={openDatabase}
          activeId={activeId}
        />

        <section className="flex min-h-[420px] min-w-0 flex-1 flex-col">
          <div className="flex min-h-9 items-end gap-px overflow-x-auto border-b border-ink-700 bg-ink-900 px-1 pt-1">
            {open.map((object) => (
              <div
                key={object.id}
                className={cx(
                  'flex shrink-0 items-center gap-1.5 rounded-t border border-b-0 px-2.5 py-1 text-xs',
                  object.id === activeId ? 'border-ink-600 bg-ink-950 text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-200',
                )}
              >
                <button type="button" onClick={() => setActiveId(object.id)} className="flex items-center gap-1.5" title={`${object.databaseName}${object.table ? `.${object.table}` : ''}`}>
                  <span className="text-ink-400">{object.type === 'info' ? Icon.database : object.type === 'view' ? Icon.view : Icon.table}</span>
                  {object.table || object.databaseName}
                </button>
                <button
                  type="button"
                  onClick={() => closeObject(object.id)}
                  className="ml-1 rounded px-1 text-ink-500 hover:bg-ink-700 hover:text-ink-200"
                  aria-label={`Close ${object.table || object.databaseName}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {active && activeDatabase ? (
            active.type === 'info' ? (
              <DatabaseInfo
                database={activeDatabase}
                usages={usage?.usages.filter((entry) => entry.databaseName === activeDatabase.name) ?? []}
                usageLoading={usageLoading}
                status={status}
              />
            ) : (
              <ObjectView key={active.id} object={active} locked={locked} onStatus={onStatus} />
            )
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-ink-400">
              {databases.length === 0 ? (
                'No databases yet.'
              ) : (
                <>
                  <span>Click a database to see where it lives and which servers use it.</span>
                  <span>Expand it to open its tables.</span>
                </>
              )}
            </div>
          )}
        </section>
      </div>
      {!databases.some((database) => database.canBrowse) && databases.length > 0 && (
        <div className="border-t border-ink-700 px-3 py-2 text-xs text-ink-400">
          <Badge>Note</Badge> Opening tables needs permission to see database passwords on the owner server.
        </div>
      )}
    </div>
  );
}
