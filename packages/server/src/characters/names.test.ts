import { describe, expect, it } from 'vitest';
import { checkCharacterName } from './names.ts';

describe('checkCharacterName', () => {
  it.each(['Ka', 'Sela', "Ve'shan", 'Ori-Tal', 'Mara Quell', 'Ana de Lune', 'Xenaxenaxenaxenaxena'])('accepts %j', (name) => {
    expect(checkCharacterName(name)).toEqual({ ok: true, name });
  });

  it.each([
    ['too short', 'K'],
    ['too long', 'Xenaxenaxenaxenaxenax'],
    ['digits', 'Kara9'],
    ['leading space', ' Kara'],
    ['trailing hyphen', 'Kara-'],
    ['leading apostrophe', "'Kara"],
    ['accented letters', 'Kåra'],
    ['punctuation', 'Kara!'],
  ])('rejects %s', (_why, name) => {
    expect(checkCharacterName(name).ok).toBe(false);
  });

  it('rejects runs of separators (via the shared schema)', () => {
    expect(checkCharacterName('Kara  Vel').ok).toBe(false);
    expect(checkCharacterName("Kara'-Vel").ok).toBe(false);
    expect(checkCharacterName('Kara --Vel').ok).toBe(false);
  });

  it('allows at most three words', () => {
    expect(checkCharacterName('An Bo Ce').ok).toBe(true);
    expect(checkCharacterName('An Bo Ce Di').ok).toBe(false);
  });

  it('rejects reserved words in any case, as whole words only', () => {
    expect(checkCharacterName('Admin').ok).toBe(false);
    expect(checkCharacterName('GM Kara').ok).toBe(false);
    expect(checkCharacterName('Kara-System').ok).toBe(false);
    expect(checkCharacterName('Admiral').ok).toBe(true);
    expect(checkCharacterName('Gemma').ok).toBe(true);
  });
});
