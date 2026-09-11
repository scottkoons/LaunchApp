import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageFit, boundImageView, zoomImageAt } from '../lib/image-view';

void test('image fit shows a whole tall screenshot without enlarging small images', () => {
  assert.equal(
    imageFit({ width: 1902, height: 2076 }, { width: 1100, height: 700 }),
    700 / 2076,
  );
  assert.equal(
    imageFit({ width: 96, height: 96 }, { width: 1000, height: 700 }),
    1,
  );
  assert.equal(
    imageFit({ width: 0, height: 0 }, { width: 1000, height: 700 }),
    1,
  );
});
void test('zoom keeps the image pixel underneath the pinch point stationary', () => {
  const image = { width: 2000, height: 1600 };
  const viewport = { width: 800, height: 600 };
  const start = { scale: 0.5, x: -25, y: 20 };
  const point = { x: 150, y: -80 };
  const zoomed = zoomImageAt(start, 1.25, point, image, viewport);
  assert.equal(
    (point.x - start.x) / start.scale,
    (point.x - zoomed.x) / zoomed.scale,
  );
  assert.equal(
    (point.y - start.y) / start.scale,
    (point.y - zoomed.y) / zoomed.scale,
  );
  const restored = zoomImageAt(zoomed, start.scale, point, image, viewport);
  assert.deepEqual(restored, start);
});
void test('panning is constrained to the image edges and recenters when it fits', () => {
  const image = { width: 1000, height: 800 };
  const viewport = { width: 800, height: 600 };
  assert.deepEqual(
    boundImageView({ scale: 1, x: 1000, y: -1000 }, image, viewport),
    { scale: 1, x: 100, y: -100 },
  );
  const fit = imageFit(image, viewport);
  const reset = boundImageView(
    { scale: fit, x: 100, y: -100 },
    image,
    viewport,
  );
  assert.equal(reset.x, 0);
  assert.equal(reset.y, 0);
});
void test('extreme pinch gestures clamp to supported zoom levels including very large images', () => {
  const image = { width: 2000, height: 1600 };
  const viewport = { width: 800, height: 600 };
  const start = { scale: 1, x: 0, y: 0 };
  assert.equal(
    zoomImageAt(start, 100, { x: 0, y: 0 }, image, viewport).scale,
    8,
  );
  assert.equal(
    zoomImageAt(start, 0, { x: 0, y: 0 }, image, viewport).scale,
    0.1,
  );
  const huge = { width: 30000, height: 40000 };
  assert.equal(
    zoomImageAt(start, 0, { x: 0, y: 0 }, huge, viewport).scale,
    imageFit(huge, viewport),
  );
});
