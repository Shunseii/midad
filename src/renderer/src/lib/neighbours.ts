/** The pages either side of `position` that exist, next page first: the ones worth loading ahead of a page turn. */
export const neighbourPages = ({ position, total }: { position: number; total: number }): number[] =>
  [position + 1, position - 1].filter((p) => p >= 1 && p <= total);
