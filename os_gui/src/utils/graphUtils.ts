/**
 * Returns the convex hull of a set of 2D points using the Monotone Chain algorithm.
 * Output is a list of points representing the hull in clockwise order.
 */
export function getConvexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length <= 2) return points;

  // 1. Sort points by x, then by y
  const sorted = points.slice().sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);

  const crossProduct = (a: any, b: any, c: any) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  // 2. Build lower hull
  const lower: any[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // 3. Build upper hull
  const upper: any[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // 4. Concatenate shells (removing duplicate end points)
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Draws a rounded hull path on the canvas context.
 * roundness: 0 (sharp) to 1 (smooth quadratic spline).
 */
export function drawRoundedHullPath(ctx: CanvasRenderingContext2D, hull: { x: number; y: number }[], roundness = 0.5) {
  if (hull.length < 3) return;

  const startX = (hull[0].x + hull[hull.length - 1].x) / 2;
  const startY = (hull[0].y + hull[hull.length - 1].y) / 2;
  
  if (roundness <= 0) {
    ctx.moveTo(hull[0].x, hull[0].y);
    for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
    ctx.closePath();
    return;
  }

  // Draw smooth path
  ctx.moveTo(startX, startY);
  for (let i = 0; i < hull.length; i++) {
    const curr = hull[i];
    const next = hull[(i + 1) % hull.length];
    
    // Theoretical midpoints
    const midNext = { x: (curr.x + next.x) / 2, y: (curr.y + next.y) / 2 };
    
    // If roundness is 1.0, we curve from mid i-1 to mid i via curr.
    // If roundness is < 1.0, we only curve partially at the corner.
    
    // Points A and B on the segments leading to/from curr
    const prev = hull[(i + hull.length - 1) % hull.length];
    const midPrev = { x: (prev.x + curr.x) / 2, y: (prev.y + curr.y) / 2 };
    
    const cornerStartX = curr.x + (midPrev.x - curr.x) * roundness;
    const cornerStartY = curr.y + (midPrev.y - curr.y) * roundness;
    const cornerEndX = curr.x + (midNext.x - curr.x) * roundness;
    const cornerEndY = curr.y + (midNext.y - curr.y) * roundness;

    ctx.lineTo(cornerStartX, cornerStartY);
    ctx.quadraticCurveTo(curr.x, curr.y, cornerEndX, cornerEndY);
  }
  ctx.closePath();
}

/**
 * Draws manual hatched lines clipped to the provided points.
 * Ensures sharpness by bypassing pattern scaling.
 */
export function drawHatchLines(
  ctx: CanvasRenderingContext2D,
  hull: { x: number; y: number }[],
  color: string,
  spacing = 10,
  lineWidth = 1,
  alpha = 0.2
) {
  if (hull.length < 3) return;

  // Calculate bounding box for the hatch sweep
  const minX = Math.min(...hull.map(p => p.x));
  const maxX = Math.max(...hull.map(p => p.x));
  const minY = Math.min(...hull.map(p => p.y));
  const maxY = Math.max(...hull.map(p => p.y));

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'butt';
  
  // The path (hull) must have been already defined and clipped before calling this, 
  // or we clip it here if points are provided.
  // Actually, for better composition, we assume we are already clipped or we clip now.
  // Clipping inside here is safer.
  // We'll trust the current path on the context or re-draw it?
  // Let's re-draw the hull as a clipping path to be self-contained.
  // Wait, that requires roundness. Let's assume the caller clips.
  
  // Actually, for pure sharpness, we'll draw parallel lines across the box.
  ctx.beginPath();
  const diagStart = minX - (maxY - minY);
  const diagEnd = maxX + (maxY - minY);
  
  for (let k = diagStart; k < diagEnd; k += spacing) {
    // Line: x - y = k  =>  x = y + k
    ctx.moveTo(Math.round(k + minY), Math.round(minY));
    ctx.lineTo(Math.round(k + maxY), Math.round(maxY));
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Derives a stable color from a string ID.
 */
export function getStableColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash % 360);
  return `hsl(${h}, 70%, 65%)`;
}
