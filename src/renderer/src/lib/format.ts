const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export const timeAgo = (at: number, now = Date.now()): string => {
  const seconds = Math.round((at - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
};

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export const arabicNumber = (n: number): string => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] ?? d);

export const plural = ({ count, one, many }: { count: number; one: string; many: string }) =>
  `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
