import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useEffect, useId } from "react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const pressable =
  "transition-[box-shadow,background-color,color] duration-150 hover:shadow-[inset_0_0_0_100px_color-mix(in_oklab,var(--color-ink)_6%,transparent)] active:shadow-[inset_0_0_0_100px_color-mix(in_oklab,var(--color-ink)_12%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-45";

const BUTTON_VARIANTS = {
  primary: "bg-accent text-on-accent",
  secondary: "bg-surface text-ink border-line",
  ghost: "bg-transparent text-ink-2",
  danger: "bg-danger-soft text-danger",
} as const;

export const Button = ({
  variant = "primary",
  size = "md",
  icon: Icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: "md" | "sm";
  icon?: LucideIcon;
}) => (
  <button
    type="button"
    className={cx(
      "inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-transparent text-sm font-medium",
      size === "md" ? "gap-1.5 px-3.5 py-2" : "gap-1 px-2.5 py-1",
      BUTTON_VARIANTS[variant],
      pressable,
      className,
    )}
    {...rest}
  >
    {Icon && <Icon className="size-4 shrink-0" />}
    {children}
  </button>
);

export const IconButton = ({
  icon: Icon,
  label,
  selected = false,
  variant = "ghost",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  selected?: boolean;
  variant?: "ghost" | "outline";
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={selected || undefined}
    className={cx(
      "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent",
      selected ? "bg-accent-soft text-accent" : "text-ink-2 hover:text-ink",
      variant === "outline" && !selected && "border-line bg-surface",
      pressable,
      className,
    )}
    {...rest}
  >
    <Icon className="size-4.5 shrink-0" />
  </button>
);

const BADGE_TONES = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
} as const;

export const Badge = ({
  tone = "neutral",
  dot = false,
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  dot?: boolean;
  children: ReactNode;
}) => (
  <span
    className={cx(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
      BADGE_TONES[tone],
    )}
  >
    {dot && <span className="size-1.5 rounded-full bg-current" />}
    {children}
  </span>
);

export const TextField = ({
  label,
  helper,
  error,
  icon: Icon,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  helper?: string;
  error?: string | null;
  icon?: LucideIcon;
}) => {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-ink-2">
          {label}
        </label>
      )}
      <div
        className={cx(
          "flex h-10 items-center gap-2 rounded-lg border bg-surface px-3 transition-[border-color,box-shadow]",
          error
            ? "border-danger shadow-[0_0_0_3px_var(--color-danger-soft)]"
            : "border-line focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]",
        )}
      >
        {Icon && <Icon className="size-4 shrink-0 text-ink-3" />}
        <input id={id} className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" {...rest} />
      </div>
      {(error || helper) && <p className={cx("text-xs", error ? "text-danger" : "text-ink-3")}>{error ?? helper}</p>}
    </div>
  );
};

export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) => (
  <div role="tablist" aria-label={label} className="inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.75">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="tab"
        aria-selected={o.value === value}
        onClick={() => onChange(o.value)}
        className={cx(
          "whitespace-nowrap rounded-md px-3 py-1.25 text-sm font-medium transition-colors",
          o.value === value ? "bg-surface text-ink shadow-xs" : "text-ink-2 hover:text-ink",
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Switch = ({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cx(
      "relative h-4.5 w-8 shrink-0 rounded-full transition-[background-color,box-shadow] duration-150 hover:shadow-[0_0_0_3px_var(--color-accent-soft)] disabled:opacity-40",
      checked ? "bg-accent" : "bg-line",
    )}
  >
    <span
      className={cx(
        "absolute top-0.5 size-3.5 rounded-full shadow-sm transition-[left] duration-150",
        checked ? "left-4 bg-on-accent" : "left-0.5 bg-surface",
      )}
    />
  </button>
);

export const Progress = ({ value, className }: { value: number; className?: string }) => (
  <div className={cx("h-1 overflow-hidden rounded-full bg-line", className)}>
    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
  </div>
);

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cx("animate-pulse rounded-md bg-line", className)} />
);

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex rounded border border-line bg-surface-2 px-1.5 py-px font-mono text-xs text-ink-2">
    {children}
  </kbd>
);

export const Dialog = ({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-lg"
      >
        <header className="flex items-start gap-3 border-b border-line px-6 py-5">
          <div className="flex flex-1 flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            {description && <p className="text-sm text-ink-3">{description}</p>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex items-center gap-2 border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>
  );
};

export const Toast = ({ children, onDone }: { children: ReactNode; onDone: () => void }) => {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center">
      <div role="status" className="rounded-lg bg-ink px-3.5 py-2.5 text-sm text-bg shadow-lg">
        {children}
      </div>
    </div>
  );
};

export { cx };
