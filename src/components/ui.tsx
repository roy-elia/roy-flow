import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronDown, CircleCheck, CircleAlert, Search, X } from 'lucide-react';
import { dismissToast, useToasts } from '../store';

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`switch ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  utils,
  style,
}: {
  tabs: { id: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  utils?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="tabs"
      role="tablist"
      style={style}
      onKeyDown={(e) => {
        const i = tabs.findIndex((t) => t.id === value);
        if (e.key === 'ArrowRight' && i < tabs.length - 1) onChange(tabs[i + 1].id);
        if (e.key === 'ArrowLeft' && i > 0) onChange(tabs[i - 1].id);
      }}
    >
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={`tab ${t.id === value ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
      {utils && <div className="tabs-utils">{utils}</div>}
    </div>
  );
}

export function useClickOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

export interface Option {
  value: string;
  label?: ReactNode;
  icon?: ReactNode;
}
export function Dropdown({
  value,
  options,
  onChange,
  disabled,
  width,
  inline,
  align = 'right',
}: {
  value: string;
  options: (string | Option)[];
  onChange: (v: string) => void;
  disabled?: boolean;
  width?: number;
  inline?: boolean;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  const opts: Option[] = options.map((o) => (typeof o === 'string' ? { value: o } : o));
  const cur = opts.find((o) => o.value === value) ?? { value };
  return (
    <div className={`dd ${open ? 'open' : ''} ${inline ? 'dd-inline' : ''}`} ref={ref} style={{ width }}>
      <button type="button" className="dd-trigger" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="dd-val">
          {cur.icon}
          {cur.label ?? cur.value}
        </span>
        <ChevronDown size={inline ? 14 : 16} strokeWidth={inline ? 2.4 : 2} />
      </button>
      {open && (
        <div className={`menu ${align === 'left' ? 'left' : ''}`} role="listbox">
          {opts.map((o) => (
            <button
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`menu-item ${o.value === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.icon}
              {o.label ?? o.value}
              {o.value === value && <Check size={14} className="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface MenuEntry {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  run: () => void;
}
export function MenuButton({ trigger, items, tip, large, className = 'icon-btn' }: { trigger: ReactNode; items: MenuEntry[]; tip?: string; large?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  return (
    <div className="dd" ref={ref}>
      <button type="button" className={`${className} ${open ? 'active' : ''}`} data-tip={open ? undefined : tip} aria-label={tip} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className={`menu ${large ? 'lg' : ''}`} role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={`menu-item ${it.danger ? 'danger' : ''}`}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const KEY_LABEL: Record<string, string> = {
  cmd: '⌘ Cmd',
  opt: '⌥ Opt',
  ctrl: '^ Ctrl',
  shift: '⇧ Shift',
  fn: 'fn',
  space: 'Space',
};
export const keyLabel = (k: string) => KEY_LABEL[k] ?? k;
export function Keys({ keys, small }: { keys: string[]; small?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {keys.map((k) => (
        <kbd key={k} className={`key ${small ? 'sm' : ''}`}>
          {keyLabel(k)}
        </kbd>
      ))}
    </span>
  );
}

export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  actions,
  width,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" style={{ width }}>
        <div className="dialog-head">
          <div className="dialog-title">{title}</div>
          {subtitle && <div className="dialog-sub">{subtitle}</div>}
        </div>
        <button className="icon-btn dialog-close" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
        {children && <div className="dialog-body">{children}</div>}
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, subtitle, confirm = 'Yes, delete it', onConfirm, onClose }: { title: string; subtitle?: string; confirm?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-destructive"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirm}
          </button>
        </>
      }
    />
  );
}

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          {t.tone === 'error' ? <CircleAlert size={18} className="err" /> : <CircleCheck size={18} className="ok" />}
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function SearchToggle({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(!!value);
  if (!open)
    return (
      <button className="icon-btn" data-tip="Search" aria-label="Search" onClick={() => setOpen(true)}>
        <Search size={18} />
      </button>
    );
  return (
    <div className="search-field">
      <Search size={14} className="muted" />
      <input autoFocus value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (onChange(''), setOpen(false))} />
      <button
        className="muted"
        aria-label="Clear search"
        onClick={() => {
          onChange('');
          setOpen(false);
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Blurred CSS-gradient stand-in for the photo heroes. */
export function Hero({
  palette,
  title,
  desc,
  wide,
  cta,
  onClose,
  children,
  titleSize,
  style,
}: {
  palette: 'amber' | 'night' | 'cinema' | 'ocean' | 'paper' | 'teal';
  title: ReactNode;
  desc?: ReactNode;
  wide?: boolean;
  cta?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
  titleSize?: 'md';
  style?: CSSProperties;
}) {
  return (
    <section className="hero" style={style}>
      <div className={`hero-bg pal-${palette}`} aria-hidden />
      <h2 className={`hero-title ${titleSize ?? ''}`}>{title}</h2>
      {desc && <p className={`hero-desc ${wide ? 'wide' : ''}`}>{desc}</p>}
      {cta && <div className="hero-cta">{cta}</div>}
      {children}
      {onClose && (
        <button className="icon-btn frost hero-close" aria-label="Dismiss" onClick={onClose}>
          <X size={16} />
        </button>
      )}
    </section>
  );
}

export function PageFrame({
  title,
  cta,
  tabs,
  children,
  maxWidth,
  className = '',
}: {
  title: ReactNode;
  cta?: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
  maxWidth?: number;
  className?: string;
}) {
  const mw: CSSProperties = { maxWidth: maxWidth ?? 'max(800px, 50vw)' };
  return (
    <main className={`page ${className}`}>
      <div className="page-top" style={mw}>
        <div className="title-row">
          <h1>{title}</h1>
          {cta}
        </div>
      </div>
      {tabs && (
        <div style={{ ...mw, width: '100%' }} className="tabs-slot">
          {tabs}
        </div>
      )}
      <div className="page-scroll" style={mw}>
        <div className="page-inner">{children}</div>
      </div>
    </main>
  );
}

export function Info({ tip }: { tip: string }) {
  return (
    <span className="info-dot" data-tip={tip} tabIndex={0} aria-label={tip}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 16.5v-5M12 8h.01" strokeLinecap="round" strokeWidth="2" />
      </svg>
    </span>
  );
}
