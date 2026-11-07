import { describe, it, expect } from "vitest";
import { layoutFrames } from "./layout-d.js";
import { discover, genSystem } from "./fixtures.js";

/** 1 locally, 25 on CI (runners are about 25× slower); KOPAI_PERF_SCALE overrides. */
const SCALE = Number(process.env.KOPAI_PERF_SCALE ?? (process.env.CI ? 25 : 1));
const BUDGET_MS = 50;

describe("updateLayout timing", () => {
  it("lays out a 600-node generated system, all 5 frames, in < 50 ms (median of 7)", () => {
    // genSystem(510, 7) is the mock-up generator at exactly 600 nodes
    const frames = discover(genSystem(510, 7));
    expect(frames[0]?.nodes).toHaveLength(600);

    layoutFrames(frames); // warm-up
    const runs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      const rs = layoutFrames(frames);
      runs.push(performance.now() - t0);
      expect(rs[4]?.positions.size).toBeGreaterThan(0);
    }
    runs.sort((a, b) => a - b);
    const median = runs[3] as number;
    console.log(
      `layout D, 600 nodes × 5 frames: median ${median.toFixed(2)} ms ` +
        `(budget ${BUDGET_MS * SCALE} ms, scale ${SCALE})`
    );
    expect(median).toBeLessThan(BUDGET_MS * SCALE);
  });
});
