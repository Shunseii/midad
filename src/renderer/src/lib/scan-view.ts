/**
 * Zoom and pan for the scan: the image is drawn at `scale` times its fit-to-width
 * size, shifted by `x`, `y` from where it sits at fit. Pure geometry, in CSS pixels.
 */

export interface ScanView {
  scale: number;
  x: number;
  y: number;
}

export interface ScanBox {
  /** The room the image has at fit: the pane less its margins. */
  width: number;
  height: number;
  /** The image's own aspect, height over width. */
  aspect: number;
}

export const FIT: ScanView = { scale: 1, x: 0, y: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

const clampTo = ({ value, min, max }: { value: number; min: number; max: number }) => Math.min(Math.max(value, min), max);

/**
 * Keeps the image covering the pane on each axis where it's larger than the
 * pane, so its edge never leaves a gap. Narrower than the pane, it's centred;
 * shorter, it sits at the top.
 */
export const clampView = ({ view, box }: { view: ScanView; box: ScanBox }): ScanView => {
  const scale = clampTo({ value: view.scale, min: MIN_SCALE, max: MAX_SCALE });
  const width = box.width * scale;
  const height = box.width * box.aspect * scale;
  const x = width <= box.width ? (box.width - width) / 2 : clampTo({ value: view.x, min: box.width - width, max: 0 });
  const y = height <= box.height ? 0 : clampTo({ value: view.y, min: box.height - height, max: 0 });
  return { scale, x, y };
};

/** Zooms to `scale` holding the image point under `at` (relative to the image's fit position) in place. */
export const zoomAt = ({ view, box, scale, at }: { view: ScanView; box: ScanBox; scale: number; at: { x: number; y: number } }): ScanView => {
  const next = clampTo({ value: scale, min: MIN_SCALE, max: MAX_SCALE });
  const ratio = next / view.scale;
  return clampView({ view: { scale: next, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio }, box });
};

/** The scale a wheel turn asks for: a mouse notch is about 15%, a pinch (which comes as Ctrl+wheel with small steps) tracks the fingers. */
export const wheelScale = ({ scale, deltaY, pinch }: { scale: number; deltaY: number; pinch: boolean }): number =>
  scale * Math.exp(-deltaY * (pinch ? 0.01 : 0.0015));

/** Whether the image is larger than the pane on either axis, so dragging can move it. */
export const canPan = ({ view, box }: { view: ScanView; box: ScanBox }): boolean =>
  box.width * view.scale > box.width + 0.5 || box.width * box.aspect * view.scale > box.height + 0.5;
