import { useRef, type ReactNode } from "react";
import { cx } from "./ui";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

/**
 * A side panel that slides over the page, for windows too narrow to show it
 * beside the text. Base UI handles focus, Esc and the click-away scrim.
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
}) => {
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={popupRef}
        side={side}
        showCloseButton={false}
        // Focus the sheet itself rather than ringing its first button.
        initialFocus={popupRef}
        className="sheet max-w-[90vw] bg-transparent"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
};

/**
 * A side panel beside the text in wide windows. It stays mounted and opens by
 * growing its column from nothing, so the page eases aside instead of jumping.
 */
export const InlinePanel = ({ side, open, children }: { side: "left" | "right"; open: boolean; children: ReactNode }) => (
  <div
    inert={!open}
    className={cx(
      "grid shrink-0 overflow-hidden transition-[grid-template-columns] duration-panel ease-sheet motion-reduce:transition-none",
      // Named so a page turn leaves the panel where it is.
      side === "left" ? "[view-transition-name:contents-panel]" : "[view-transition-name:side-panel]",
      open ? "grid-cols-[1fr]" : "grid-cols-[0fr]",
    )}
  >
    <div className={cx("flex min-h-0 min-w-0", side === "right" && "justify-end")}>{children}</div>
  </div>
);
