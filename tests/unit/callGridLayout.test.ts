import { describe, expect, it } from 'vitest';
import { bestGridLayout } from '@/components/calling/gridLayout';

const fits = (count: number, w: number, h: number, gap = 12) => {
  const l = bestGridLayout(count, w, h, gap);
  expect(l.cols * l.rows).toBeGreaterThanOrEqual(count);
  expect(l.cols * l.tileWidth + gap * (l.cols - 1)).toBeLessThanOrEqual(w);
  expect(l.rows * l.tileHeight + gap * (l.rows - 1)).toBeLessThanOrEqual(h);
  return l;
};

describe('bestGridLayout', () => {
  it('fits 3 people on screen without cutting anyone off (2 on top, 1 below)', () => {
    const l = fits(3, 1280, 520);
    expect(l.cols).toBe(2);
    expect(l.rows).toBe(2);
    expect(l.tileWidth).toBeGreaterThan(400);
    expect(Math.round(l.tileWidth / l.tileHeight * 100) / 100).toBeCloseTo(16 / 9, 1);
  });

  it('puts 2 people side by side on a wide screen', () => {
    expect(fits(2, 1280, 600).cols).toBe(2);
  });

  it('stacks 2 people on a tall phone screen', () => {
    expect(fits(2, 390, 700).cols).toBe(1);
  });

  it('always fits, for any number of people and window size', () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 9, 12, 16]) {
      for (const [w, h] of [[1280, 520], [800, 600], [390, 700], [1920, 900], [600, 300]]) {
        fits(count, w, h);
      }
    }
  });

  it('never returns negative sizes for a tiny or unmeasured stage', () => {
    const l = bestGridLayout(4, 0, 0, 12);
    expect(l.tileWidth).toBeGreaterThanOrEqual(0);
    expect(l.tileHeight).toBeGreaterThanOrEqual(0);
  });
});
