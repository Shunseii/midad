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
