import { useRef, useState, type ReactNode } from "react";
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
 * growing its width from nothing while the panel rides its inner edge in
 * from the window edge as one piece, and the page eases aside. The width only
 * animates when the panel opens or closes, so resizing by drag stays direct.
 */
export const InlinePanel = ({
  side,
  open,
  width,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  width: number;
  children: ReactNode;
}) => {
  const [shownOpen, setShownOpen] = useState(open);
  const [moving, setMoving] = useState(false);
  if (shownOpen !== open) {
    setShownOpen(open);
    setMoving(true);
  }
  return (
    <div
      inert={!open}
      style={{ width: open ? width : 0 }}
      onTransitionEnd={(e) => e.target === e.currentTarget && setMoving(false)}
      className={cx(
        "relative h-full shrink-0 overflow-hidden",
        moving && "transition-[width] duration-panel ease-sheet motion-reduce:transition-none",
        // Named so a page turn leaves the panel where it is.
        side === "left" ? "[view-transition-name:contents-panel]" : "[view-transition-name:side-panel]",
      )}
    >
      <div style={{ width }} className={cx("absolute inset-y-0 flex", side === "right" ? "left-0" : "right-0")}>
        {children}
      </div>
    </div>
  );
};
