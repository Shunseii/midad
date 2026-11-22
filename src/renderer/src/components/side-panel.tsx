import type { ReactNode } from "react";
import { cx } from "./ui";

type Side = "left" | "right";

/** The drag handle on a panel's inner edge: dragging it resizes the panel, double-clicking resets it. */
export const ResizeHandle = ({
  side,
  width,
  onResize,
  onResetSize,
}: {
  side: Side;
  width: number;
  onResize: (width: number) => void;
  onResetSize: () => void;
}) => (
  <div
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize panel"
    title="Drag to resize · double-click to reset"
    onDoubleClick={onResetSize}
    onPointerDown={(e) => {
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      // The inner edge is the right one for the left panel, so dragging right widens it.
      const grow = side === "left" ? 1 : -1;
      const move = (ev: PointerEvent) => onResize(width + grow * (ev.clientX - startX));
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", () => handle.removeEventListener("pointermove", move), { once: true });
    }}
    className={cx(
      "absolute inset-y-0 z-10 w-2 cursor-col-resize transition-colors hover:bg-accent-soft active:bg-accent-soft",
      side === "left" ? "-right-1" : "-left-1",
    )}
  />
);

/**
 * A side panel of the reader, on either side: a header bar, a resize handle on
 * its inner edge, and the body (usually a `SidePanelBody`). Both sides share it,
 * so they look alike.
 */
export const SidePanel = ({
  side,
  as: Tag = "aside",
  label,
  width,
  onResize,
  onResetSize,
  switchList,
  header,
  children,
}: {
  side: Side;
  as?: "aside" | "nav";
  label: string;
  width: number;
  onResize: (width: number) => void;
  onResetSize: () => void;
  /** Names the whole panel for a list switch that changes all of it (see switchListInTransition). */
  switchList?: string;
  header: ReactNode;
  children: ReactNode;
}) => (
  <Tag
    aria-label={label}
    data-switch-list={switchList}
    style={{ width }}
    className={cx("relative flex min-h-0 shrink-0 flex-col border-line bg-surface", side === "left" ? "border-r" : "border-l")}
  >
    <ResizeHandle side={side} width={width} onResize={onResize} onResetSize={onResetSize} />
    <div className="flex h-15 shrink-0 items-center gap-2 border-b border-line px-4">{header}</div>
    {children}
  </Tag>
);

/** A side panel's scrolling body. Key it by tab where each tab's list should open at its top. */
export const SidePanelBody = ({ switchList, className, children }: { switchList?: string; className?: string; children: ReactNode }) => (
  <div data-switch-list={switchList} className={cx("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}>
    {children}
  </div>
);
