// Initial path-mode viewing direction (pure; no DOM/Three). The camera looks perpendicular to the
// dominant horizontal axis of the path points (principal axis of their XZ spread), so long X or Z arcs
// are seen broadside instead of foreshortened, with a mild elevation and slight yaw for depth.
import type { Vec3 } from '../model/types.ts';

/** Elevation above the horizontal plane, degrees. */
export const PATH_VIEW_ELEVATION_DEG = 15;
/** Yaw away from exact broadside, degrees (keeps some depth cue; cos(10°) ≈ 0.985 of full width). */
export const PATH_VIEW_YAW_DEG = 10;
/** Preferred side when the axis leaves the sign free (matches the default orbit's +X/+Z quadrant). */
const PREFERRED: readonly [number, number] = [2.2, 3.2];

/**
 * Unit direction from target toward the camera for the initial path view. Falls back to the
 * preferred diagonal when the points have no measurable horizontal spread.
 */
export function pathViewDirection(pointSets: readonly (readonly Vec3[])[]): Vec3 {
  let n = 0, mx = 0, mz = 0;
  for (const pts of pointSets) for (const p of pts) { n += 1; mx += p[0]; mz += p[2]; }
  let hx = PREFERRED[0], hz = PREFERRED[1];
  if (n > 1) {
    mx /= n; mz /= n;
    let cxx = 0, czz = 0, cxz = 0;
    for (const pts of pointSets) for (const p of pts) {
      const dx = p[0] - mx, dz = p[2] - mz;
      cxx += dx * dx; czz += dz * dz; cxz += dx * dz;
    }
    if (cxx + czz > 1e-12) {
      const theta = 0.5 * Math.atan2(2 * cxz, cxx - czz); // Principal axis (cos θ, sin θ) in (x, z).
      hx = -Math.sin(theta); hz = Math.cos(theta); // Perpendicular in the horizontal plane.
      if (hx * PREFERRED[0] + hz * PREFERRED[1] < 0) { hx = -hx; hz = -hz; }
      // Slight yaw toward the preferred side for a depth cue.
      const s = hx * PREFERRED[1] - hz * PREFERRED[0] >= 0 ? 1 : -1;
      const y = (s * PATH_VIEW_YAW_DEG * Math.PI) / 180;
      const rx = hx * Math.cos(y) - hz * Math.sin(y), rz = hx * Math.sin(y) + hz * Math.cos(y);
      hx = rx; hz = rz;
    }
  }
  const hl = Math.hypot(hx, hz);
  const e = (PATH_VIEW_ELEVATION_DEG * Math.PI) / 180;
  return [(hx / hl) * Math.cos(e), Math.sin(e), (hz / hl) * Math.cos(e)];
}
