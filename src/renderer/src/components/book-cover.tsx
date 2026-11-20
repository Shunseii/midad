import type { CSSProperties } from "react";
import { cx } from "./ui";

/**
 * A book drawn like a classical title page: a double-rule frame, a small
 * ornament, the title, a short rule and the author.
 */
export const BookCover = ({ title, author, size, className, style }: { title: string; author: string | null; size: "sm" | "md"; className?: string; style?: CSSProperties }) => (
  <div
    data-cover
    style={style}
    className={cx(
      "relative flex aspect-[3/4] shrink-0 flex-col items-center justify-center overflow-hidden rounded-md border border-line bg-surface text-center",
      size === "md" ? "w-36 gap-2.5 p-5" : "w-full gap-2 p-4",
      className,
    )}
  >
    <span aria-hidden className="absolute inset-2 rounded-sm border-3 border-double border-ink-3/50" />
    <span aria-hidden className="size-1.5 rotate-45 border border-accent" />
    <span className={cx("ar font-bold leading-relaxed text-ink", size === "md" ? "text-ar-small" : "text-ar-body")}>{title}</span>
    <span aria-hidden className="h-px w-8 bg-ink-3/60" />
    {author && <span className="ar text-xs leading-relaxed text-ink-2">{author}</span>}
  </div>
);

/** Names the cover for the opening view transition, so it grows into the page. Only one cover can carry the name at a time. */
export const markOpeningCover = (from: Element) => {
  for (const el of document.querySelectorAll<HTMLElement>("[data-cover]")) el.style.viewTransitionName = "";
  const cover = from.closest("[data-book]")?.querySelector<HTMLElement>("[data-cover]");
  if (cover) cover.style.viewTransitionName = "book-cover";
  document.documentElement.dataset.opening = "";
};
