// Checks for the second machine-readable (MRZ) line of a TD3 passport (ICAO 9303).
// Positions below are 1-based, as in the standard.
//
//   1-9   document number      10  check digit
//   11-13 nationality
//   14-19 birth date (YYMMDD)  20  check digit
//   21    sex
//   22-27 expiry (YYMMDD)      28  check digit
//   29-42 optional data        43  check digit ('<' allowed when 29-42 are all '<')
//   44    composite check digit over 1-10, 14-20 and 22-43

export type MrzCheckCode =
  | 'MRZ_LENGTH'
  | 'MRZ_CHECK_DOCUMENT'
  | 'MRZ_CHECK_DOB'
  | 'MRZ_CHECK_EXPIRY'
  | 'MRZ_CHECK_OPTIONAL'
  | 'MRZ_CHECK_COMPOSITE'
  | 'MRZ_PASSPORT_MISMATCH'
  | 'MRZ_DOB_MISMATCH';

const WEIGHTS = [7, 3, 1];

export function mrzCharValue(char: string): number {
  if (char === '<') return 0;
  if (char >= '0' && char <= '9') return char.charCodeAt(0) - 48;
  if (char >= 'A' && char <= 'Z') return char.charCodeAt(0) - 55; // A = 10 ... Z = 35
  throw new Error(`Character "${char}" is not allowed in an MRZ`);
}

/** The ICAO 9303 check digit: weights 7, 3, 1 repeating, sum mod 10. */
export function mrzCheckDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i += 1) sum += mrzCharValue(field[i]) * WEIGHTS[i % 3];
  return sum % 10;
}

function digitMatches(field: string, check: string, fillerAllowed = false): boolean {
  if (fillerAllowed && check === '<') return mrzCheckDigit(field) === 0;
  if (!/^\d$/.test(check)) return false;
  return mrzCheckDigit(field) === Number(check);
}

/** Converts YYMMDD to YYYY-MM-DD, taking the latest century that doesn't put the date in the future. */
export function mrzBirthDate(yymmdd: string, today: Date): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const month = yymmdd.slice(2, 4);
  const day = yymmdd.slice(4, 6);
  const todayIso = today.toISOString().slice(0, 10);
  const in2000s = `${2000 + yy}-${month}-${day}`;
  return in2000s <= todayIso ? in2000s : `${1900 + yy}-${month}-${day}`;
}

export interface MrzCheckInput {
  line2: string;
  passportNumber?: string | null;
  dateOfBirth?: string | null;
  today: Date;
}

// Models often miscount a long run of '<'. When the optional data (29-42) is empty, that
// run carries no information, so it is rebuilt at its correct length of 14. Positions 1-28
// must still end in a digit, and every check digit is still verified afterwards.
const EMPTY_OPTIONAL = /^([0-9A-Z<]{27}\d)<+([0-9<]\d)$/;

export function normalizeMrzLine2(line2: string): string {
  const line = line2.replace(/\s+/g, '').toUpperCase();
  if (line.length === 44) return line;
  const match = EMPTY_OPTIONAL.exec(line);
  return match ? `${match[1]}${'<'.repeat(14)}${match[2]}` : line;
}

export function checkMrzLine2(input: MrzCheckInput): MrzCheckCode[] {
  const line = normalizeMrzLine2(input.line2);
  if (line.length !== 44 || !/^[0-9A-Z<]+$/.test(line)) return ['MRZ_LENGTH'];

  const at = (from: number, to: number) => line.slice(from - 1, to); // 1-based, inclusive
  const failed: MrzCheckCode[] = [];

  if (!digitMatches(at(1, 9), at(10, 10))) failed.push('MRZ_CHECK_DOCUMENT');
  if (!digitMatches(at(14, 19), at(20, 20))) failed.push('MRZ_CHECK_DOB');
  if (!digitMatches(at(22, 27), at(28, 28))) failed.push('MRZ_CHECK_EXPIRY');
  const optional = at(29, 42);
  if (!digitMatches(optional, at(43, 43), /^<+$/.test(optional))) failed.push('MRZ_CHECK_OPTIONAL');
  if (!digitMatches(at(1, 10) + at(14, 20) + at(22, 43), at(44, 44))) failed.push('MRZ_CHECK_COMPOSITE');

  if (input.passportNumber) {
    const mrzNumber = at(1, 9).replace(/<+$/, '');
    if (mrzNumber !== input.passportNumber.replace(/\s+/g, '').toUpperCase()) failed.push('MRZ_PASSPORT_MISMATCH');
  }
  if (input.dateOfBirth) {
    if (mrzBirthDate(at(14, 19), input.today) !== input.dateOfBirth) failed.push('MRZ_DOB_MISMATCH');
  }
  return failed;
}
