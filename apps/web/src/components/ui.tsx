import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-ice-400 text-ink-950 hover:bg-ice-300 focus-visible:outline-ice-300',
  secondary: 'bg-ink-700 text-ink-100 hover:bg-ink-600 focus-visible:outline-ink-400',
  danger: 'bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30 hover:bg-red-500/25 focus-visible:outline-red-400',
  ghost: 'text-ink-300 hover:bg-ink-800 hover:text-ink-100 focus-visible:outline-ink-400',
};

export function Button({
  variant = 'secondary',
  busy,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45',
        buttonStyles[variant],
        className,
      )}
    >
      {busy && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

export function Input({ label, hint, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: ReactNode }) {
  const input = (
    <input
      {...props}
      className={cx(
        // 16px on phones: iOS zooms the page into smaller inputs.
        'w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-base text-ink-100 placeholder:text-ink-500 sm:text-sm',
        'focus:border-ice-500 focus:ring-2 focus:ring-ice-500/25 focus:outline-none',
        className,
      )}
    />
  );
  if (!label) return input;
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-ink-200">{label}</span>
      {input}
      {hint && <span className="block text-xs text-ink-400">{hint}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-ink-700 bg-ink-850', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'green' | 'yellow' | 'red' | 'ice';
const toneStyles: Record<Tone, string> = {
  neutral: 'bg-ink-700 text-ink-200',
  green: 'bg-emerald-500/15 text-emerald-300',
  yellow: 'bg-amber-500/15 text-amber-300',
  red: 'bg-red-500/15 text-red-300',
  ice: 'bg-ice-500/15 text-ice-300',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', toneStyles[tone])}>{children}</span>;
}

export function Alert({ tone = 'red', children }: { tone?: 'red' | 'yellow' | 'ice'; children: ReactNode }) {
  const styles = {
    red: 'border-red-500/30 bg-red-500/10 text-red-200',
    yellow: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    ice: 'border-ice-500/30 bg-ice-500/10 text-ice-100',
  }[tone];
  return <div className={cx('rounded-lg border px-4 py-3 text-sm', styles)}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', className ?? 'size-5')} aria-hidden />;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 md:mb-6 md:gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight text-ink-100 md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const stateTone: Record<string, Tone> = { running: 'green', starting: 'yellow', stopping: 'yellow', offline: 'neutral' };

export function StateBadge({ state }: { state: string | null | undefined }) {
  if (!state) return <Badge>Unknown</Badge>;
  return (
    <Badge tone={stateTone[state] ?? 'neutral'}>
      <span className={cx('size-1.5 rounded-full bg-current', state === 'running' && 'animate-pulse')} />
      {state.charAt(0).toUpperCase() + state.slice(1)}
    </Badge>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" fill="currentColor" className="text-ink-800" />
      <path d="M16 5v22M6.5 10.5l19 11M6.5 21.5l19-11" stroke="#5ee7ff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** Centered dialog with a dimmed backdrop. Esc or clicking the backdrop closes it. */
export function Dialog({
  title,
  children,
  footer,
  onClose,
  wide,
}: {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cx(
          'flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-ink-700 bg-ink-850 shadow-2xl sm:rounded-xl',
          wide ? 'sm:max-w-5xl' : 'sm:max-w-lg',
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-5 py-3.5">
          <h2 className="min-w-0 truncate text-sm font-semibold text-ink-100">{title}</h2>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100" aria-label="Close">
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-ink-700 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
