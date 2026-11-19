import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The app's own font sizes. Without them, tailwind-merge reads `text-ar-small` as a colour and drops it next to `text-ink-2`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ["display", "title", "heading", "body", "small", "overline", "ar-display", "ar-reading", "ar-body", "ar-small"] },
  },
});

/** Joins class names, letting later Tailwind classes override earlier ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
