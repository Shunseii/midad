const LINES_PER_STEP = 3;
/** How far ahead of the page a held key may push the goal, so key repeat never queues a backlog. */
const MAX_LEAD_STEPS = 2;
/** Share of the remaining distance covered each frame. */
const EASE_PER_FRAME = 0.25;

interface Glide {
  goal: number;
}

const glides = new WeakMap<HTMLElement, Glide>();

const lineHeightIn = (scroller: HTMLElement) => {
  const { lineHeight, fontSize } = getComputedStyle(scroller.querySelector("[data-w]") ?? scroller);
  const height = Number.parseFloat(lineHeight);
  return Number.isFinite(height) ? height : Number.parseFloat(fontSize) * 1.6;
};

export const scrollStepOf = (scroller: HTMLElement) => Math.min(lineHeightIn(scroller) * LINES_PER_STEP, scroller.clientHeight * 0.5);

/**
 * Scrolls a few lines down (1) or up (-1). Presses in a row extend one glide,
 * capped a couple of steps ahead, so holding the key scrolls evenly.
 */
export const scrollByStep = ({ scroller, direction }: { scroller: HTMLElement; direction: 1 | -1 }) => {
  const step = scrollStepOf(scroller) * direction;
  const max = scroller.scrollHeight - scroller.clientHeight;
  const clamp = (top: number) => Math.min(Math.max(top, 0), max);

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    scroller.scrollTop = clamp(scroller.scrollTop + step);
    return;
  }

  const now = scroller.scrollTop;
  const running = glides.get(scroller);
  const sameWay = running !== undefined && Math.sign(running.goal - now) === direction;
  const from = sameWay ? running.goal : now;
  const lead = Math.abs(step) * MAX_LEAD_STEPS;
  const goal = clamp(direction > 0 ? Math.min(from + step, now + lead) : Math.max(from + step, now - lead));

  if (running) {
    running.goal = goal;
    return;
  }

  const glide: Glide = { goal };
  glides.set(scroller, glide);
  const tick = () => {
    const left = glide.goal - scroller.scrollTop;
    if (Math.abs(left) < 1) {
      scroller.scrollTop = glide.goal;
      glides.delete(scroller);
      return;
    }
    const before = scroller.scrollTop;
    scroller.scrollTop = before + Math.sign(left) * Math.max(1, Math.round(Math.abs(left) * EASE_PER_FRAME));
    // The page stopped moving (its end, or the user scrolled against it).
    if (scroller.scrollTop === before) {
      glides.delete(scroller);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
