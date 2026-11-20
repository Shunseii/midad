import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type RefObject, useEffect, useId, useRef } from "react";
import { toast } from "sonner";
import { Badge as BadgeBase } from "@/components/ui/badge";
import { Button as ButtonBase } from "@/components/ui/button";
import {
  Dialog as DialogRoot,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd as KbdBase } from "@/components/ui/kbd";
import { Progress as ProgressBase } from "@/components/ui/progress";
import { Skeleton as SkeletonBase } from "@/components/ui/skeleton";
import { Switch as SwitchBase } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const cx = cn;

const BUTTON_VARIANTS = {
  primary: "default",
  secondary: "outline",
  ghost: "ghost",
  danger: "destructive",
} as const;

export const Button = ({
  variant = "primary",
  size = "md",
  icon: Icon,
  type = "button",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: "md" | "sm";
  icon?: LucideIcon;
}) => (
  <ButtonBase type={type} variant={BUTTON_VARIANTS[variant]} size={size === "md" ? "default" : "sm"} {...rest}>
    {Icon && <Icon />}
    {children}
  </ButtonBase>
);

export const IconButton = ({
  icon: Icon,
  label,
  selected = false,
  variant = "ghost",
  type = "button",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  selected?: boolean;
  variant?: "ghost" | "outline";
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <ButtonBase
          type={type}
          variant={variant}
          size="icon"
          aria-label={label}
          aria-pressed={selected || undefined}
          className={cn(selected ? "bg-accent-soft text-accent" : "text-ink-2 hover:text-ink", className)}
          {...rest}
        />
      }
    >
      <Icon />
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

const BADGE_TONES = {
  neutral: "secondary",
  accent: "default",
  ok: "ok",
  warn: "warn",
  danger: "destructive",
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
  <BadgeBase variant={BADGE_TONES[tone]}>
    {dot && <span className="size-1.5 rounded-full bg-current" />}
    {children}
  </BadgeBase>
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
  ref?: Ref<HTMLInputElement>;
}) => {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-ink-2">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {Icon && <Icon className="pointer-events-none absolute left-3 size-4 text-ink-3" />}
        <Input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || helper ? messageId : undefined}
          className={cn(Icon && "pl-9")}
          {...rest}
        />
      </div>
      {(error || helper) && (
        <p id={messageId} className={cn("text-xs", error ? "text-danger" : "text-ink-3")}>
          {error ?? helper}
        </p>
      )}
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
  <Tabs
    value={value}
    onValueChange={(next) => {
      const option = options.find((o) => o.value === next);
      if (option) onChange(option.value);
    }}
  >
    <TabsList aria-label={label}>
      {options.map((o) => (
        <TabsTrigger key={o.value} value={o.value}>
          {o.label}
        </TabsTrigger>
      ))}
    </TabsList>
  </Tabs>
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
}) => <SwitchBase aria-label={label} checked={checked} onCheckedChange={onChange} disabled={disabled} />;

export const Progress = ({ value, className }: { value: number; className?: string }) => (
  <ProgressBase value={Math.max(0, Math.min(1, value)) * 100} className={className} />
);

export const Skeleton = ({ className }: { className?: string }) => <SkeletonBase className={className} />;

export const Kbd = ({ children }: { children: ReactNode }) => <KbdBase>{children}</KbdBase>;

export const Dialog = ({
  title,
  description,
  onClose,
  children,
  footer,
  initialFocus,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
}) => {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      {/* The dialog opens without a trigger, so focus the panel rather than ringing its close button. */}
      <DialogContent ref={popup} initialFocus={initialFocus ?? popup} showCloseButton={false}>
        <DialogHeader>
          <div className="flex flex-1 flex-col gap-0.5">
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </div>
          <DialogClose render={<IconButton icon={X} label="Close" />} />
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </DialogRoot>
  );
};

const TOAST_DURATION_MS = 4000;

const ToastBody = ({ children }: { children: ReactNode }) => (
  <div className="flex w-full justify-center">
    <div role="status" className="rounded-xl bg-ink px-3.5 py-2.5 text-sm text-bg shadow-float">
      {children}
    </div>
  </div>
);

/** Shows `children` as a sonner toast while mounted; calls `onDone` when it times out or is swiped away. */
export const Toast = ({ children, onDone }: { children: ReactNode; onDone: () => void }) => {
  const toastId = useRef<string | number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let mounted = true;
    const finish = () => {
      if (mounted) onDoneRef.current();
    };
    // Created a tick later so StrictMode's mount-unmount-mount doesn't leave a second toast animating out.
    const timer = setTimeout(() => {
      toastId.current = toast.custom(() => <ToastBody>{children}</ToastBody>, {
        duration: TOAST_DURATION_MS,
        unstyled: true,
        className: "w-full",
        onAutoClose: finish,
        onDismiss: finish,
      });
    });
    return () => {
      mounted = false;
      clearTimeout(timer);
      if (toastId.current !== null) toast.dismiss(toastId.current);
      toastId.current = null;
    };
    // Content changes are pushed into the live toast by the effect below.
  }, []);

  useEffect(() => {
    if (toastId.current !== null) toast.custom(() => <ToastBody>{children}</ToastBody>, { id: toastId.current });
  }, [children]);

  return null;
};

export { cx };
