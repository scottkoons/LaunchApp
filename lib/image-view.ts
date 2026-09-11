export type ImageSize = { width: number; height: number };
export type ImageView = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
export const maxImageZoom = 8;

export function imageFit(image: ImageSize, viewport: ImageSize) {
  if (!image.width || !image.height || !viewport.width || !viewport.height)
    return 1;
  return Math.min(
    1,
    viewport.width / image.width,
    viewport.height / image.height,
  );
}

export function boundImageView(
  view: ImageView,
  image: ImageSize,
  viewport: ImageSize,
): ImageView {
  const scale = Math.max(
    Math.min(0.1, imageFit(image, viewport)),
    Math.min(maxImageZoom, view.scale),
  );
  const xLimit = Math.max(0, (image.width * scale - viewport.width) / 2);
  const yLimit = Math.max(0, (image.height * scale - viewport.height) / 2);
  return {
    scale,
    x: xLimit ? Math.max(-xLimit, Math.min(xLimit, view.x)) : 0,
    y: yLimit ? Math.max(-yLimit, Math.min(yLimit, view.y)) : 0,
  };
}

// Points are measured from the viewport center. Keep the image pixel under the
// gesture in the same place, then constrain panning to the image edges.
export function zoomImageAt(
  view: ImageView,
  scale: number,
  point: Point,
  image: ImageSize,
  viewport: ImageSize,
) {
  const nextScale = boundImageView({ ...view, scale }, image, viewport).scale;
  const ratio = nextScale / view.scale;
  return boundImageView(
    {
      scale: nextScale,
      x: point.x - (point.x - view.x) * ratio,
      y: point.y - (point.y - view.y) * ratio,
    },
    image,
    viewport,
  );
}
