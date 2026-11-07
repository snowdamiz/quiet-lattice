import { describe, expect, it } from 'vitest';
import { dependentOutput, expectedDependentBytes } from './dependent-output.js';
import { timerRenderer } from '../../test/timer-renderer.js';

describe('dependent output control: CPU contract only', () => {
  it('computes different expected bytes through the spatial dependency chain', () => {
    expect(expectedDependentBytes(1, 0, 0)).toEqual([18, 42, 68, 96]);
    expect(expectedDependentBytes(4, 0, 0)).toEqual([159, 94, 40, 221]);
    expect(expectedDependentBytes(1, 255, 255)).not.toEqual(expectedDependentBytes(4, 255, 255));
  });

  it('restores the exact prior target/face/mip and consumes prior outputs in a renderer stand-in', () => {
    const { renderer, state, original } = timerRenderer();
    const fixture = dependentOutput(renderer);
    const work = [];
    fixture.render(4, work);
    const proof = fixture.read();
    expect(proof.matches).toBe(true);
    expect(proof.sampleChecksum).toBe(proof.expectedSampleChecksum);
    expect(proof.points[0].actual).toEqual([159, 94, 40, 221]);
    expect(work).toHaveLength(4);
    expect(work.every((p) => p.completed && p.calls === 1 && p.triangles === 1)).toBe(true);
    expect(state.target).toBe(original);
    expect([state.face, state.mip, renderer.autoClear]).toEqual([2, 3, true]);
    fixture.dispose();
    expect(state.disposed.size).toBe(5);
    expect(state.disposed.has(original)).toBe(false);
  });

  it('keeps a wrong output visibly mismatched rather than substituting expected bytes', () => {
    const { renderer } = timerRenderer(() => {}, { corruptReadback: true });
    const fixture = dependentOutput(renderer);
    fixture.render(1, []);
    const proof = fixture.read();
    expect(proof.matches).toBe(false);
    expect(proof.sampleChecksum).not.toBe(proof.expectedSampleChecksum);
    expect(proof.points.every((p) => !p.matches)).toBe(true);
    fixture.dispose();
  });

  it('restores target state and retains partial work after a render failure', () => {
    const { renderer, state, original } = timerRenderer(() => {}, { failDraw: 2 });
    const fixture = dependentOutput(renderer);
    const work = [];
    expect(() => fixture.render(4, work)).toThrow('Dependent draw failed');
    expect(work.map((p) => p.completed)).toEqual([true, false]);
    expect(state.target).toBe(original);
    fixture.dispose();
    expect(state.disposed.size).toBe(5);
  });

  it.each([0, 5, 1.5, NaN])('rejects unbounded fixture passes (%s)', (steps) => {
    const { renderer } = timerRenderer();
    const fixture = dependentOutput(renderer);
    expect(() => fixture.render(steps, [])).toThrow('integer from 1 to 4');
    fixture.dispose();
  });
});
