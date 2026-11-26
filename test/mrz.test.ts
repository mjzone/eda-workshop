import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkMrzLine2, mrzBirthDate, mrzCheckDigit, normalizeMrzLine2 } from '../functions/validate-fields/src/rules/mrz';
import { passportMrz } from '../test-data/generate-specimens';

const today = new Date('2026-11-23T00:00:00Z');

describe('mrzCheckDigit', () => {
  it('passes every check digit of the ICAO specimen line', () => {
    // L898902C36UTO7408122F1204159ZE184226B<<<<<10 (ICAO 9303 example)
    assert.deepEqual(checkMrzLine2({ line2: 'L898902C36UTO7408122F1204159ZE184226B<<<<<10', today }), []);
  });

  it('computes known check digits', () => {
    assert.equal(mrzCheckDigit('L898902C3'), 6);
    assert.equal(mrzCheckDigit('740812'), 2);
    assert.equal(mrzCheckDigit('<<<<<<<<<<<<<<'), 0);
  });
});

describe('checkMrzLine2', () => {
  const [, valid] = passportMrz({
    surname: 'PERSON',
    givenNames: 'SPECIMEN',
    sex: 'F',
    dob: '1990-02-12',
    expiry: '2031-02-11',
    number: 'N1234567',
  });

  it('accepts the passport_valid specimen and its cross-checks', () => {
    assert.equal(valid, 'N1234567<7LKA9002122F3102112<<<<<<<<<<<<<<04');
    assert.deepEqual(checkMrzLine2({ line2: valid, passportNumber: 'N1234567', dateOfBirth: '1990-02-12', today }), []);
  });

  it('allows "<" as the optional-data check digit when that data is empty', () => {
    const withFiller = `${valid.slice(0, 42)}<${valid.slice(43)}`;
    assert.ok(!checkMrzLine2({ line2: withFiller, today }).includes('MRZ_CHECK_OPTIONAL'));
  });

  it('catches a wrong birth-date check digit', () => {
    const broken = `${valid.slice(0, 19)}3${valid.slice(20)}`;
    const failed = checkMrzLine2({ line2: broken, today });
    assert.ok(failed.includes('MRZ_CHECK_DOB'));
    assert.ok(failed.includes('MRZ_CHECK_COMPOSITE'));
  });

  it('cross-checks the passport number and the birth date', () => {
    const failed = checkMrzLine2({ line2: valid, passportNumber: 'N7654321', dateOfBirth: '1990-02-13', today });
    assert.deepEqual(failed, ['MRZ_PASSPORT_MISMATCH', 'MRZ_DOB_MISMATCH']);
  });

  it('reports a line of the wrong length', () => {
    assert.deepEqual(checkMrzLine2({ line2: 'N1234567<7LKA', today }), ['MRZ_LENGTH']);
  });

  it('rebuilds a miscounted run of filler when the optional data is empty', () => {
    // Nova Pro's reading of passport_valid: 18 fillers instead of 14.
    const tooLong = 'N1234567<7LKA9002122F3102112<<<<<<<<<<<<<<<<<<04';
    assert.equal(normalizeMrzLine2(tooLong), 'N1234567<7LKA9002122F3102112<<<<<<<<<<<<<<04');
    assert.deepEqual(checkMrzLine2({ line2: tooLong, today }), []);
    assert.deepEqual(checkMrzLine2({ line2: 'N1234567<7LKA9002122F3102112<<<<<<<<04', today }), []);
  });

  it('still catches a wrong check digit after rebuilding the filler', () => {
    const badDob = 'N1234567<7LKA9002123F3102112<<<<<<<<<<<<<<<<<<04';
    assert.ok(checkMrzLine2({ line2: badDob, today }).includes('MRZ_CHECK_DOB'));
  });

  it('does not rebuild a line whose optional data holds characters', () => {
    assert.deepEqual(checkMrzLine2({ line2: 'N1234567<7LKA9002122F3102112AB<<<<<<<<<<<<<<<<04', today }), ['MRZ_LENGTH']);
  });

  it('picks the century that does not put the birth date in the future', () => {
    assert.equal(mrzBirthDate('900212', today), '1990-02-12');
    assert.equal(mrzBirthDate('050101', today), '2005-01-01');
    assert.equal(mrzBirthDate('301231', today), '1930-12-31');
  });
});
