import { Children, isValidElement, useEffect, useState } from 'react';
import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { clsx } from './clsx';

/* ---------- Botones ---------- */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60';
  const sizes = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-6 py-2.5 text-sm',
    lg: 'px-8 py-3.5 text-base',
  };
  const variants = {
    primary: 'bg-brand-600 text-white shadow-md shadow-brand-600/25 hover:bg-brand-700',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    ghost: 'border border-brand-200 bg-brand-50 text-brand-800 shadow-sm shadow-brand-900/5 hover:border-brand-400 hover:bg-brand-100',
    success: 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25 hover:bg-emerald-700',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
  };
  return (
    <button
      className={clsx(base, sizes[size], variants[variant], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

/* ---------- Campos de formulario ---------- */
interface FieldWrapperProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FieldWrapper({ label, htmlFor, hint, error, required, children, className }: FieldWrapperProps) {
  return (
    <label htmlFor={htmlFor} className={clsx('flex min-w-0 max-w-full flex-col gap-1.5', className)}>
      <span className="text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
      {hint && !error && <p className="break-words text-xs text-slate-500">{hint}</p>}
      {error && <p className="break-words text-xs font-medium text-rose-600">{error}</p>}
    </label>
  );
}

const inputBase =
  'min-h-12 min-w-0 w-full max-w-full rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 shadow-sm shadow-slate-900/5 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}
export function Input({ invalid, className, ...rest }: InputProps) {
  return <input className={clsx(inputBase, invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/25', className)} {...rest} />;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  invalid?: boolean;
  children: ReactNode;
}
export function Select({ invalid, className, children, ...rest }: SelectProps) {
  const { value, onChange, disabled, name, required, id } = rest;
  const [open, setOpen] = useState(false);
  const selectedValue = value === undefined || value === null ? '' : String(value);
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const props = child.props as { value?: string | number; label?: string; children?: ReactNode; disabled?: boolean };
    const label = props.label ?? (typeof props.children === 'string' || typeof props.children === 'number' ? String(props.children) : '');
    return props.value === undefined ? [] : [{ value: String(props.value), label, disabled: !!props.disabled }];
  });
  const selected = options.find((option) => option.value === selectedValue);
  const placeholder = options.find((option) => option.value === '')?.label ?? 'Selecciona…';
  const choose = (nextValue: string) => {
    if (disabled) return;
    onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue } } as React.ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };
  return (
    <span className="relative block min-w-0 max-w-full" onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
      {name && <input type="hidden" name={name} value={selectedValue} required={required} />}
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-required={required}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={clsx(
          inputBase,
          'flex cursor-pointer items-center justify-between gap-3 pr-3 text-left',
          invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/25',
          className,
        )}
      >
        <span className={clsx('truncate', !selected && 'text-slate-400')}>{selected?.label ?? placeholder}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={clsx('h-5 w-5 shrink-0 text-brand-600 transition', open && 'rotate-180')}>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && !disabled && (
        <span role="listbox" className="absolute z-30 mt-2 max-h-64 w-full overflow-auto rounded-2xl border border-brand-100 bg-white p-1.5 shadow-xl shadow-brand-900/15">
          {options.map((option) => (
            <button
              key={option.value || '__empty'}
              type="button"
              role="option"
              aria-selected={option.value === selectedValue}
              disabled={option.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option.value)}
              className={clsx('flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-medium text-slate-700 transition hover:bg-brand-50 hover:text-brand-900 disabled:cursor-not-allowed disabled:opacity-45', option.value === selectedValue && 'bg-brand-600 font-bold text-white hover:bg-brand-600 hover:text-white')}
            >
              {option.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  id?: string;
  value: string;
  options: SearchableSelectOption[];
  placeholder: string;
  emptyMessage: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/** Selector con búsqueda local para catálogos extensos, como las marcas de vehículo. */
export function SearchableSelect({ id = 'searchable-select', value, options, placeholder, emptyMessage, disabled, onChange }: SearchableSelectProps) {
  const selected = options.find((option) => option.value === value);
  const [query, setQuery] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) setQuery(selected?.label ?? '');
  }, [selected?.label, open]);

  const normalizedQuery = query.trim().toLocaleLowerCase('es');
  const matches = options
    .filter((option) => option.label.toLocaleLowerCase('es').includes(normalizedQuery))
    .slice(0, 50);

  return (
    <div className="relative min-w-0 max-w-full" onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
      <div className="relative">
        <input
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-autocomplete="list"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (value) onChange('');
          }}
          className={clsx(inputBase, 'pr-10')}
        />
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-600">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </div>
      {open && !disabled && (
        <div id={`${id}-options`} role="listbox" className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-brand-200 bg-white p-1.5 shadow-xl shadow-brand-900/10">
          {matches.length ? matches.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={clsx('block w-full rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-brand-50 hover:text-brand-900', option.value === value && 'bg-brand-50 font-semibold text-brand-900')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onChange(option.value); setQuery(option.label); setOpen(false); }}
            >
              {option.label}
            </button>
          )) : <p className="px-3 py-2.5 text-sm text-slate-500">{emptyMessage}</p>}
        </div>
      )}
    </div>
  );
}

interface OptionProps {
  value: string;
  label: string;
}
export function Option({ value, label }: OptionProps) {
  return <option value={value}>{label}</option>;
}

/* ---------- Tarjetas ---------- */
export function Card({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <div id={id} className={clsx('min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6', className)}>
      {children}
    </div>
  );
}

/* ---------- Badge ---------- */
interface BadgeProps {
  tone?: 'brand' | 'emerald' | 'amber' | 'rose' | 'slate';
  children: ReactNode;
  className?: string;
}
export function Badge({ tone = 'slate', children, className }: BadgeProps) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1', tones[tone], className)}>
      {children}
    </span>
  );
}

/* ---------- Alertas ---------- */
interface AlertProps {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: ReactNode;
  className?: string;
}
export function Alert({ tone = 'info', title, children, className }: AlertProps) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
  };
  return (
    <div className={clsx('rounded-xl border p-4', tones[tone], className)}>
      {title && <p className="mb-1 text-sm font-bold">{title}</p>}
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

/* ---------- Divider ---------- */
export function Divider({ label }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-3">
      <div className="h-px flex-1 bg-slate-200" />
      {label && <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</span>}
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

/* ---------- Checkbox ---------- */
interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
  invalid?: boolean;
}
export function Checkbox({ label, checked, onChange, className, invalid = false }: CheckboxProps) {
  return (
    <label className={clsx(
      'flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4 transition hover:border-brand-300 hover:shadow-sm',
      checked ? 'border-brand-300 bg-brand-50/60' : invalid ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200',
      className,
    )}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-invalid={invalid || undefined}
        className="peer sr-only"
      />
      <span aria-hidden="true" className={clsx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 bg-white text-transparent transition peer-checked:border-brand-600 peer-checked:bg-brand-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/35', invalid ? 'border-rose-400' : 'border-slate-300')}>
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 10 3.5 3.5L16 5.5" />
        </svg>
      </span>
      <span className="pt-0.5 text-sm font-medium leading-snug text-slate-700">{label}</span>
    </label>
  );
}

