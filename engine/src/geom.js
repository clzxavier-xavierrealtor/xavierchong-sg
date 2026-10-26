// Small 2D helpers. World frame: x = east (m), z = south (m), y = up.
export const rad = d => d * Math.PI / 180;
export const pairs = flat => { const o = []; for (let i = 0; i < flat.length; i += 2) o.push([flat[i], flat[i + 1]]); return o; };

export function inPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function distToSeg(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

export function distToPolyline(x, z, pts, closed = false) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distToSeg(x, z, pts[i], pts[i + 1]));
  if (closed && pts.length > 2) d = Math.min(d, distToSeg(x, z, pts[pts.length - 1], pts[0]));
  return d;
}

export function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
export function centroid(p) { let x = 0, z = 0; p.forEach(q => { x += q[0]; z += q[1]; }); return [x / p.length, z / p.length]; }

// Points every `step` metres along a polyline, with the local direction.
export function along(pts, step, offset0 = 0) {
  const out = []; let carry = offset0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
    if (L < 1e-6) continue;
    const ux = (x2 - x1) / L, uz = (z2 - z1) / L;
    for (let s = carry; s < L; s += step) out.push({ x: x1 + ux * s, z: z1 + uz * s, ux, uz });
    carry = (carry - L) % step; if (carry < 0) carry += step;
  }
  return out;
}

// Seeded random for stable layouts.
export function rng(seed = 7) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// Compass bearing (0 = north, 90 = east) of a vector in world x/z.
export const bearing = (dx, dz) => (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
export const compass = b => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(b / 45) % 8];
export const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
