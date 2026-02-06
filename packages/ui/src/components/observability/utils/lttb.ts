/**
 * Largest Triangle Three Buckets (LTTB) downsampling algorithm
 */

export interface LTTBPoint {
  x: number;
  y: number;
}

function triangleArea(p1: LTTBPoint, p2: LTTBPoint, p3: LTTBPoint): number {
  return (
    Math.abs((p1.x - p3.x) * (p2.y - p1.y) - (p1.x - p2.x) * (p3.y - p1.y)) / 2
  );
}

export function downsampleLTTB(
  data: LTTBPoint[],
  targetPoints: number
): LTTBPoint[] {
  if (targetPoints >= data.length || targetPoints <= 2) {
    return data.length <= 2 ? data : data.slice();
  }

  const sampled: LTTBPoint[] = [];
  const bucketSize = (data.length - 2) / (targetPoints - 2);

  const firstPoint = data[0];
  if (!firstPoint) return data;
  sampled.push(firstPoint);

  let prevSelectedIndex = 0;

  for (let i = 0; i < targetPoints - 2; i++) {
    const bucketStart = Math.floor((i + 0) * bucketSize) + 1;
    const bucketEnd = Math.min(
      Math.floor((i + 1) * bucketSize) + 1,
      data.length - 1
    );

    const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextBucketEnd = Math.min(
      Math.floor((i + 2) * bucketSize) + 1,
      data.length - 1
    );

    let avgX = 0;
    let avgY = 0;
    let nextBucketCount = 0;

    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      const point = data[j];
      if (point) {
        avgX += point.x;
        avgY += point.y;
        nextBucketCount++;
      }
    }

    if (nextBucketCount > 0) {
      avgX /= nextBucketCount;
      avgY /= nextBucketCount;
    } else {
      const lastPoint = data[data.length - 1];
      if (lastPoint) {
        avgX = lastPoint.x;
        avgY = lastPoint.y;
      }
    }

    const avgPoint: LTTBPoint = { x: avgX, y: avgY };

    let maxArea = -1;
    let maxAreaIndex = bucketStart;

    const prevPoint = data[prevSelectedIndex];
    if (!prevPoint) continue;

    for (let j = bucketStart; j < bucketEnd; j++) {
      const currentPoint = data[j];
      if (!currentPoint) continue;
      const area = triangleArea(prevPoint, currentPoint, avgPoint);
      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    const selectedPoint = data[maxAreaIndex];
    if (selectedPoint) {
      sampled.push(selectedPoint);
    }
    prevSelectedIndex = maxAreaIndex;
  }

  const lastPoint = data[data.length - 1];
  if (lastPoint) {
    sampled.push(lastPoint);
  }

  return sampled;
}

export function downsampleTimeSeries<
  T extends { timestamp: number; value: number },
>(data: T[], targetPoints: number): T[] {
  if (targetPoints >= data.length) {
    return data;
  }

  const points: LTTBPoint[] = data.map((d) => ({
    x: d.timestamp,
    y: d.value,
  }));

  const sampled = downsampleLTTB(points, targetPoints);
  const sampledTimestamps = new Set(sampled.map((p) => p.x));
  return data.filter((d) => sampledTimestamps.has(d.timestamp));
}
