import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cx } from "./ui";

/**
 * A side panel that slides over the page, for windows too narrow to show it
 * beside the text. Radix handles focus, Esc and the click-away scrim.
 */
export const SideSheet = ({
  side,
  open,
  onOpenChange,
  title,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-scrim fixed inset-0 z-50 bg-scrim" />
      <Dialog.Content
        aria-describedby={undefined}
        // Keep focus on the sheet itself rather than ringing its first button.
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-side={side}
        className={cx("sheet fixed inset-y-0 z-50 flex max-w-[90vw] shadow-lg outline-none", side === "left" ? "left-0" : "right-0")}
      >
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);

/**
 * A side panel beside the text in wide windows. It stays mounted and opens by
 * growing its column from nothing, so the page eases aside instead of jumping.
 */
export const InlinePanel = ({ side, open, children }: { side: "left" | "right"; open: boolean; children: ReactNode }) => (
  <div
    inert={!open}
    className={cx(
      "grid shrink-0 overflow-hidden transition-[grid-template-columns] duration-240 ease-out motion-reduce:transition-none",
      open ? "grid-cols-[1fr]" : "grid-cols-[0fr]",
    )}
  >
    <div className={cx("flex min-h-0 min-w-0", side === "right" && "justify-end")}>{children}</div>
  </div>
);
