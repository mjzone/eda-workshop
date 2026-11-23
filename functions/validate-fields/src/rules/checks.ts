// Every check the workflow runs on the model's output. Each failed check has a code and
// a kind. Format checks can never be overridden; an officer can override the others.
// See docs/requirements.md, section 5.5.

import { decodeNic } from './nic';
import { checkMrzLine2 } from './mrz';

export type DocumentType = 'PASSPORT' | 'NIC';
export type CheckKind = 'format' | 'overridable';

export interface ExtractedFields {
  document_type: 'PASSPORT' | 'NIC' | 'UNKNOWN' | null;
  full_name: string | null;
  date_of_birth: string | null;
  sex: 'M' | 'F' | null;
  nic_number: string | null;
  passport_number: string | null;
  mrz_line1: string | null;
  mrz_line2: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
}

export const EMPTY_FIELDS: ExtractedFields = {
  document_type: null,
  full_name: null,
  date_of_birth: null,
  sex: null,
  nic_number: null,
  passport_number: null,
  mrz_line1: null,
  mrz_line2: null,
  confidence: null,
};

export const CHECK_KINDS = {
  MISSING_NAME: 'format',
  MISSING_DOB: 'format',
  MISSING_ID: 'format',
  DOB_FORMAT: 'format',
  LOW_CONFIDENCE: 'overridable',
  EXTRACTION_ERROR: 'overridable',
  DOC_TYPE_MISMATCH: 'overridable',
  NIC_FORMAT: 'format',
  NIC_DAY_INVALID: 'format',
  NIC_DOB_MISMATCH: 'overridable',
  NIC_SEX_MISMATCH: 'overridable',
  PASSPORT_FORMAT: 'format',
  MRZ_LENGTH: 'format',
  MRZ_CHECK_DOCUMENT: 'overridable',
  MRZ_CHECK_DOB: 'overridable',
  MRZ_CHECK_EXPIRY: 'overridable',
  MRZ_CHECK_OPTIONAL: 'overridable',
  MRZ_CHECK_COMPOSITE: 'overridable',
  MRZ_PASSPORT_MISMATCH: 'overridable',
  MRZ_DOB_MISMATCH: 'overridable',
} as const satisfies Record<string, CheckKind>;

export type CheckCode = keyof typeof CHECK_KINDS;

export interface FailedCheck {
  code: CheckCode;
  kind: CheckKind;
}

export interface CheckInput {
  manifestType: DocumentType;
  fields: ExtractedFields;
  extractionError: boolean;
  passportPattern: RegExp;
  today: Date;
}

const blank = (value: string | null | undefined) => value === null || value === undefined || value.trim() === '';

export function isValidIsoDate(value: string, today: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  return value <= today.toISOString().slice(0, 10);
}

export function runChecks(input: CheckInput): FailedCheck[] {
  const { fields, manifestType, today } = input;
  const codes: CheckCode[] = [];

  if (input.extractionError) codes.push('EXTRACTION_ERROR');
  if (blank(fields.full_name)) codes.push('MISSING_NAME');
  if (blank(fields.date_of_birth)) codes.push('MISSING_DOB');
  if (blank(fields.nic_number) && blank(fields.passport_number)) codes.push('MISSING_ID');

  const dobValid = !blank(fields.date_of_birth) && isValidIsoDate(fields.date_of_birth!, today);
  if (!blank(fields.date_of_birth) && !dobValid) codes.push('DOB_FORMAT');

  if (fields.confidence === 'low') codes.push('LOW_CONFIDENCE');
  if (fields.document_type !== null && fields.document_type !== manifestType) codes.push('DOC_TYPE_MISMATCH');

  if (!blank(fields.nic_number)) {
    const nic = decodeNic(fields.nic_number!);
    if (!nic.ok) {
      codes.push(nic.code);
    } else {
      if (dobValid && nic.birthDate !== fields.date_of_birth) codes.push('NIC_DOB_MISMATCH');
      if (fields.sex && nic.sex !== fields.sex) codes.push('NIC_SEX_MISMATCH');
    }
  }

  const passportNumber = blank(fields.passport_number) ? null : fields.passport_number!.replace(/\s+/g, '').toUpperCase();
  if (passportNumber && !input.passportPattern.test(passportNumber)) codes.push('PASSPORT_FORMAT');

  if (!blank(fields.mrz_line2)) {
    codes.push(
      ...checkMrzLine2({
        line2: fields.mrz_line2!,
        passportNumber,
        dateOfBirth: dobValid ? fields.date_of_birth : null,
        today,
      }),
    );
  }

  return [...new Set(codes)].map((code) => ({ code, kind: CHECK_KINDS[code] }));
}
