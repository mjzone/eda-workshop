import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { namesMatch, normalizeName } from '../functions/validate-fields/src/rules/names';

describe('normalizeName', () => {
  it('upper-cases and removes punctuation and extra spaces', () => {
    assert.equal(normalizeName('  k.  a.   Perera '), 'K A PERERA');
    assert.equal(normalizeName("O'Brien-Silva"), 'O BRIEN SILVA');
  });

  it('keeps Sinhala combining marks', () => {
    assert.equal(normalizeName('කමල් පෙරේරා'), 'කමල් පෙරේරා');
  });
});

describe('namesMatch', () => {
  const stored = 'KAMAL ANURA PERERA';

  it('matches the full name in any order', () => {
    assert.ok(namesMatch('Kamal Anura Perera', stored));
    assert.ok(namesMatch('Perera Kamal Anura', stored));
    assert.ok(namesMatch('SPECIMEN PERSON', 'PERSON SPECIMEN'));
  });

  it('matches initials with a real name', () => {
    assert.ok(namesMatch('K. A. PERERA', stored));
    assert.ok(namesMatch('kamal perera', stored));
  });

  it('rejects initials alone and short tokens alone', () => {
    assert.ok(!namesMatch('K. A.', stored));
    assert.ok(!namesMatch('KA', stored));
  });

  it('rejects a different name', () => {
    assert.ok(!namesMatch('K. A. PEREIRA', stored));
    assert.ok(!namesMatch('NIMAL PERERA', stored));
    assert.ok(!namesMatch('', stored));
  });
});
