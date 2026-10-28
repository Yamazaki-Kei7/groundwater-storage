import type { Viewport } from '@deck.gl/core';

/** Whether the camera-to-column ray clears the globe, in deck.gl common space. */
export function isGlobePositionVisible(viewport: Viewport, position: [number, number, number]): boolean {
  const surface = viewport.projectPosition([position[0], position[1], 0]);
  const point = viewport.projectPosition(position);
  const camera = viewport.cameraPosition;
  const direction = point.map((value, i) => value - camera[i]);
  const lengthSquared = direction.reduce((sum, value) => sum + value * value, 0);
  if (lengthSquared === 0) return true;
  const closest = Math.max(0, Math.min(1,
    -camera.reduce((sum, value, i) => sum + value * direction[i], 0) / lengthSquared));
  const distanceSquared = camera.reduce((sum, value, i) => sum + (value + closest * direction[i]) ** 2, 0);
  const radiusSquared = surface.reduce((sum, value) => sum + value * value, 0);
  // Allow floating-point roundoff when the ray ends exactly on the surface.
  return distanceSquared >= radiusSquared * (1 - 1e-10);
}
