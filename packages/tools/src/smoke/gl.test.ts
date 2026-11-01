import { describe, expect, it } from 'vitest';
import { smokeBackend } from './gl.ts';

describe('smoke rendering backend', () => {
  it('uses hardware unless software rendering is requested', () => {
    expect(smokeBackend(undefined, 'darwin')).toBe('metal');
    expect(smokeBackend(undefined, 'linux')).toBe('gpu');
    expect(smokeBackend(undefined, 'win32')).toBe('gpu');
    expect(smokeBackend('swiftshader', 'darwin')).toBe('swiftshader');
    expect(smokeBackend('swiftshader', 'linux')).toBe('swiftshader');
  });

  it('rejects a misspelled renderer', () => {
    expect(() => smokeBackend('swiftshder', 'darwin')).toThrow('Unknown SMOKE_GL');
  });
});
