/**
 * Where each interlinear gloss on one screen row goes, from measured boxes. Pure, so
 * the rules can be tested without a browser. In order:
 *   1. centred under its words;
 *   2. spread sideways into free space, neighbours pushing each other apart;
 *   3. moved above its words;
 *   4. wrapped onto two short lines (under, then above);
 *   5. last resort, a further lane under the row (extra leading for that row only).
 * Note corners and footnote refs are taken space next to the text, so they block the
 * lane nearest the words. Nothing placed ever overlaps anything else.
 */

export interface Interval {
  left: number;
  right: number;
}

export interface GlossBox {
  id: string;
  /** Where its words are on the row. */
  base: Interval;
  /** Its width on one line. */
  width: number;
  /** Its width wrapped onto two lines, or null when it can't wrap (a single word). */
  twoLineWidth: number | null;
}

export interface RowInput {
  /** The column the row sits in; glosses stay inside it. */
  bounds: Interval;
  glosses: GlossBox[];
  /** Taken space in the lane just under the words, and just over them. */
  obstacles: { below: Interval[]; above: Interval[] };
}

export type Slot = "below" | "above";

export interface PlacedGloss {
  id: string;
  slot: Slot;
  /** How many gloss lines out from the words it starts: 0 is right against them. */
  lane: number;
  lines: number;
  left: number;
  width: number;
}

export interface RowLayout {
  placed: PlacedGloss[];
  /** How many gloss lines the row needs under and over its words. */
  below: number;
  above: number;
}

export interface LayoutOptions {
  /** Space kept between two glosses, and between a gloss and taken space. */
  gap: number;
  /** How far past its words a gloss may be pushed before it moves instead. */
  reach: number;
}

interface Item {
  id: string;
  base: Interval;
  width: number;
  lines: number;
}

const centre = (i: Interval) => (i.left + i.right) / 2;

const overlaps = ({ a, b, gap }: { a: Interval; b: Interval; gap: number }) => a.left < b.right + gap && b.left < a.right + gap;

/**
 * Packs items into one lane: each wants to sit centred on its words, overlapping
 * neighbours merge into a block centred on what its members want, and the block is
 * kept inside the bounds. Returns each item's left edge, in the items' order.
 */
const pack = ({ items, bounds, gap }: { items: Item[]; bounds: Interval; gap: number }): number[] => {
  const order = items.map((_, i) => i).sort((a, b) => centre(items[a]!.base) - centre(items[b]!.base));
  type Block = { members: number[]; width: number; want: number };
  const blocks: Block[] = [];
  const leftOf = (b: Block) => b.want - b.width / 2;
  const fit = (b: Block) => {
    const half = b.width / 2;
    b.want = Math.min(Math.max(b.want, bounds.left + half), bounds.right - half);
  };
  for (const i of order) {
    const item = items[i]!;
    const block: Block = { members: [i], width: item.width, want: centre(item.base) };
    fit(block);
    blocks.push(block);
    // Merge back while the newest block runs into the one before it.
    for (;;) {
      const last = blocks.at(-1)!;
      const prev = blocks.at(-2);
      if (!prev || leftOf(prev) + prev.width + gap <= leftOf(last)) break;
      blocks.pop();
      const members = [...prev.members, ...last.members];
      const width = prev.width + gap + last.width;
      // Centre the merged block on the mean of where each member would like its own centre.
      let offset = 0;
      let sum = 0;
      for (const m of members) {
        const w = items[m]!.width;
        sum += centre(items[m]!.base) - (offset + w / 2);
        offset += w + gap;
      }
      prev.members = members;
      prev.width = width;
      prev.want = sum / members.length + width / 2;
      fit(prev);
    }
  }
  const lefts = new Array<number>(items.length);
  for (const b of blocks) {
    let x = leftOf(b);
    for (const m of b.members) {
      lefts[m] = x;
      x += items[m]!.width + gap;
    }
  }
  return lefts;
};

const fits = ({ item, left, bounds, obstacles, options }: { item: Item; left: number; bounds: Interval; obstacles: Interval[]; options: LayoutOptions }) => {
  if (Number.isNaN(left)) return false;
  const box = { left, right: left + item.width };
  if (box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5) return false;
  if (box.right < item.base.left - options.reach || box.left > item.base.right + options.reach) return false;
  return !obstacles.some((o) => overlaps({ a: box, b: o, gap: options.gap }));
};

/**
 * Packs as many items into a lane as fit, evicting the worst placed one at a time.
 * Returns the placed lefts by id and the ids that didn't fit.
 */
/** The stretches of a lane between pieces of taken space. */
const freeSegments = ({ bounds, obstacles, gap }: { bounds: Interval; obstacles: Interval[]; gap: number }): Interval[] => {
  const segments: Interval[] = [];
  let from = bounds.left;
  for (const o of [...obstacles].sort((a, b) => a.left - b.left)) {
    if (o.left - gap > from) segments.push({ left: from, right: Math.min(bounds.right, o.left - gap) });
    from = Math.max(from, o.right + gap);
  }
  if (from < bounds.right) segments.push({ left: from, right: bounds.right });
  return segments;
};

/** Packs each item into the free stretch nearest its words, so neighbours spread around taken space. */
const packAround = ({ items, bounds, obstacles, gap }: { items: Item[]; bounds: Interval; obstacles: Interval[]; gap: number }): number[] => {
  const segments = freeSegments({ bounds, obstacles, gap });
  if (segments.length === 0) return items.map(() => Number.NaN);
  const distance = (s: Interval, x: number) => (x < s.left ? s.left - x : x > s.right ? x - s.right : 0);
  const home = items.map((item) => {
    const c = centre(item.base);
    return segments.reduce((best, s, i) => (distance(s, c) < distance(segments[best]!, c) ? i : best), 0);
  });
  const lefts = new Array<number>(items.length).fill(Number.NaN);
  segments.forEach((segment, si) => {
    const members = items.map((item, i) => ({ item, i })).filter(({ i }) => home[i] === si);
    const packed = pack({ items: members.map((m) => m.item), bounds: segment, gap });
    members.forEach((m, k) => {
      lefts[m.i] = packed[k]!;
    });
  });
  return lefts;
};

const fill = ({ items, bounds, obstacles, options }: { items: Item[]; bounds: Interval; obstacles: Interval[]; options: LayoutOptions }) => {
  let inLane = [...items];
  const evicted: Item[] = [];
  for (;;) {
    const lefts = packAround({ items: inLane, bounds, obstacles, gap: options.gap });
    const bad = inLane
      .map((item, i) => ({ item, i, shift: Number.isNaN(lefts[i]!) ? Number.POSITIVE_INFINITY : Math.abs(lefts[i]! + item.width / 2 - centre(item.base)) }))
      .filter(({ item, i }) => !fits({ item, left: lefts[i]!, bounds, obstacles, options }));
    if (bad.length === 0) return { placed: new Map(inLane.map((item, i) => [item.id, lefts[i]!])), evicted };
    const worst = bad.reduce((a, b) => (b.shift > a.shift ? b : a));
    evicted.push(worst.item);
    inLane = inLane.filter((_, i) => i !== worst.i);
  }
};

export const layoutRow = ({ row, options }: { row: RowInput; options: LayoutOptions }): RowLayout => {
  const { bounds } = row;
  const span = bounds.right - bounds.left;
  const byId = new Map(row.glosses.map((g) => [g.id, g]));
  const one = (g: GlossBox): Item => ({ id: g.id, base: g.base, width: Math.min(g.width, span), lines: g.width > span ? Math.ceil(g.width / span) : 1 });
  const two = (g: GlossBox): Item | null => (g.twoLineWidth === null || g.width <= g.twoLineWidth ? null : { id: g.id, base: g.base, width: Math.min(g.twoLineWidth, span), lines: 2 });

  const lanes: Record<Slot, Item[]> = { below: [], above: [] };
  const lefts = new Map<string, number>();

  // 1–2: everything under, spread apart.
  const under = fill({ items: row.glosses.map(one), bounds, obstacles: row.obstacles.below, options });
  for (const item of row.glosses.map(one)) if (under.placed.has(item.id)) lanes.below.push(item);
  for (const [id, x] of under.placed) lefts.set(id, x);

  // 3: what didn't fit goes over its words.
  const over = fill({ items: under.evicted.map((i) => one(byId.get(i.id)!)), bounds, obstacles: row.obstacles.above, options });
  for (const item of under.evicted) if (over.placed.has(item.id)) lanes.above.push(one(byId.get(item.id)!));
  for (const [id, x] of over.placed) lefts.set(id, x);

  // 4: two short lines, under and then over, alongside what's already in that lane.
  let left = over.evicted.map((i) => byId.get(i.id)!);
  for (const slot of ["below", "above"] as const) {
    const still: GlossBox[] = [];
    for (const g of left) {
      const wrapped = two(g);
      if (!wrapped) {
        still.push(g);
        continue;
      }
      const tried = fill({ items: [...lanes[slot], wrapped], bounds, obstacles: row.obstacles[slot], options });
      if (tried.evicted.length > 0) {
        still.push(g);
        continue;
      }
      lanes[slot].push(wrapped);
      for (const [id, x] of tried.placed) lefts.set(id, x);
    }
    left = still;
  }

  const placed: PlacedGloss[] = [
    ...lanes.below.map((i) => ({ id: i.id, slot: "below" as const, lane: 0, lines: i.lines, left: lefts.get(i.id)!, width: i.width })),
    ...lanes.above.map((i) => ({ id: i.id, slot: "above" as const, lane: 0, lines: i.lines, left: lefts.get(i.id)!, width: i.width })),
  ];

  // 5: further lanes under the row, clear of the words, until everything has a place.
  // Taken space blocks only the lane against the words; past it the lanes are free.
  let lane = Math.max(row.obstacles.below.length > 0 ? 1 : 0, ...placed.filter((p) => p.slot === "below").map((p) => p.lane + p.lines));
  let rest = left.map((g) => two(g) ?? one(g));
  while (rest.length > 0) {
    const tried = fill({ items: rest, bounds, obstacles: [], options: { ...options, reach: Number.POSITIVE_INFINITY } });
    const inLane = rest.filter((i) => tried.placed.has(i.id));
    // A lane always takes at least one: alone, a gloss fits the bounds.
    const taken = inLane.length > 0 ? inLane : rest.slice(0, 1);
    const xs = inLane.length > 0 ? tried.placed : new Map(taken.map((i) => [i.id, bounds.left]));
    for (const i of taken) placed.push({ id: i.id, slot: "below", lane, lines: i.lines, left: xs.get(i.id)!, width: i.width });
    lane += Math.max(...taken.map((i) => i.lines));
    rest = rest.filter((i) => !taken.includes(i));
  }

  const extent = (slot: Slot) => Math.max(0, ...placed.filter((p) => p.slot === slot).map((p) => p.lane + p.lines));
  return { placed, below: extent("below"), above: extent("above") };
};

/** Whether any two placed glosses, or a gloss and taken space, overlap. For tests and the layout sweep. */
export const overlapsIn = ({ layout, obstacles, gap = 0 }: { layout: RowLayout; obstacles: RowInput["obstacles"]; gap?: number }): boolean => {
  const { placed } = layout;
  const box = (p: PlacedGloss) => ({ left: p.left, right: p.left + p.width });
  const rows = (p: PlacedGloss) => ({ from: p.lane, to: p.lane + p.lines });
  for (const [i, a] of placed.entries()) {
    for (const b of placed.slice(i + 1)) {
      if (a.slot !== b.slot) continue;
      const ra = rows(a);
      const rb = rows(b);
      if (ra.from < rb.to && rb.from < ra.to && overlaps({ a: box(a), b: box(b), gap: gap - 0.01 })) return true;
    }
    if (a.lane === 0 && obstacles[a.slot].some((o) => overlaps({ a: box(a), b: o, gap: gap - 0.01 }))) return true;
  }
  return false;
};

/** The row a gloss's words mostly sit on (the first, on a tie), and where its words are on that row. */
export const attachment = (words: { row: number; box: Interval }[]): { row: number; base: Interval } | null => {
  const counts = new Map<number, number>();
  for (const w of words) counts.set(w.row, (counts.get(w.row) ?? 0) + 1);
  let row: number | null = null;
  for (const [r, n] of [...counts].sort((a, b) => a[0] - b[0])) if (row === null || n > (counts.get(row) ?? 0)) row = r;
  if (row === null) return null;
  const on = words.filter((w) => w.row === row);
  return { row, base: { left: Math.min(...on.map((w) => w.box.left)), right: Math.max(...on.map((w) => w.box.right)) } };
};
