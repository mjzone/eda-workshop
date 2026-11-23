// Sri Lankan NIC numbers encode the holder's birth year, day of the year and sex.
//
//   Old format: 9 digits + V or X   e.g. 905431234V  -> 19|90, day 543
//   New format: 12 digits           e.g. 199054301234 -> 1990, day 543
//
// A day number above 500 means the holder is female; subtract 500 to get the day.
// The day count treats every year as a leap year (February always has 29 days).
// See docs/requirements.md, VAL-3, VAL-4 and A-13 (to be confirmed, D-1).

export type NicSex = 'M' | 'F';

export type NicDecodeResult =
  | { ok: true; format: 'OLD' | 'NEW'; birthDate: string; sex: NicSex }
  | { ok: false; code: 'NIC_FORMAT' | 'NIC_DAY_INVALID' };

const OLD_FORMAT = /^\d{9}[VX]$/;
const NEW_FORMAT = /^\d{12}$/;
const MONTH_LENGTHS_LEAP = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Removes spaces and upper-cases the letter, so "905431234 v" becomes "905431234V". */
export function cleanNic(nic: string): string {
  return nic.replace(/\s+/g, '').toUpperCase();
}

export function decodeNic(rawNic: string): NicDecodeResult {
  const nic = cleanNic(rawNic);
  let format: 'OLD' | 'NEW';
  let year: number;
  let encodedDay: number;

  if (OLD_FORMAT.test(nic)) {
    format = 'OLD';
    year = 1900 + Number(nic.slice(0, 2));
    encodedDay = Number(nic.slice(2, 5));
  } else if (NEW_FORMAT.test(nic)) {
    format = 'NEW';
    year = Number(nic.slice(0, 4));
    encodedDay = Number(nic.slice(4, 7));
  } else {
    return { ok: false, code: 'NIC_FORMAT' };
  }

  const sex: NicSex = encodedDay > 500 ? 'F' : 'M';
  const day = encodedDay > 500 ? encodedDay - 500 : encodedDay;
  if (day < 1 || day > 366) return { ok: false, code: 'NIC_DAY_INVALID' };

  let remaining = day;
  let month = 0;
  while (remaining > MONTH_LENGTHS_LEAP[month]) {
    remaining -= MONTH_LENGTHS_LEAP[month];
    month += 1;
  }
  // Day 60 is 29 February, which only exists in a leap year.
  if (month === 1 && remaining === 29 && !isLeapYear(year)) {
    return { ok: false, code: 'NIC_DAY_INVALID' };
  }

  const birthDate = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(remaining).padStart(2, '0')}`;
  return { ok: true, format, birthDate, sex };
}

/** Convenience wrapper: the birth date encoded in a NIC, or null if the NIC is invalid. */
export function nicBirthDate(nic: string): { date: string; sex: NicSex } | null {
  const result = decodeNic(nic);
  return result.ok ? { date: result.birthDate, sex: result.sex } : null;
}
