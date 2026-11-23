// Builds the record that SaveRecord writes to the found-documents table.
// The table keeps only what matching needs and what the desk needs to find the item.
// No full document numbers, no sex, no MRZ lines, no raw model output (REC-1).

import { normalizeName } from './names';
import type { DocumentType, ExtractedFields } from './checks';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The last four digits of a document number, ignoring letters: N1234567 -> 4567. */
export function last4Digits(documentNumber: string): string | null {
  const digits = documentNumber.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function idLast4(fields: Pick<ExtractedFields, 'nic_number' | 'passport_number'>): string[] {
  const values = [fields.nic_number, fields.passport_number]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map(last4Digits)
    .filter((v): v is string => v !== null);
  return [...new Set(values)];
}

/** A short code the desk can look up, e.g. LF-7Q2K. */
export function makeReference(random: () => number): string {
  let code = '';
  for (let i = 0; i < 4; i += 1) code += CROCKFORD[Math.floor(random() * CROCKFORD.length)];
  return `LF-${code}`;
}

export interface RecordInput {
  itemId: string;
  documentType: DocumentType;
  fields: ExtractedFields;
  now: Date;
  random: () => number;
  recordTtlDays: number;
  collectionPoint: string;
  overriddenChecks?: string[];
}

export interface FoundDocumentRecord {
  item_id: string;
  document_type: DocumentType;
  name_normalized: string;
  date_of_birth: string;
  id_last4: Set<string>;
  status: 'HELD';
  reference: string;
  collection_point: string;
  registered_at: string;
  image_prefix: string;
  expires_at: number;
  review?: { override: boolean; overridden_checks: string[] };
}

export function buildRecord(input: RecordInput): FoundDocumentRecord {
  const last4 = idLast4(input.fields);
  if (last4.length === 0) throw new Error('A record needs at least one document number');
  const record: FoundDocumentRecord = {
    item_id: input.itemId,
    document_type: input.documentType,
    name_normalized: normalizeName(input.fields.full_name ?? ''),
    date_of_birth: input.fields.date_of_birth ?? '',
    id_last4: new Set(last4),
    status: 'HELD',
    reference: makeReference(input.random),
    collection_point: input.collectionPoint,
    registered_at: input.now.toISOString(),
    image_prefix: `found/${input.itemId}/`,
    expires_at: Math.floor(input.now.getTime() / 1000) + input.recordTtlDays * 86_400,
  };
  if (input.overriddenChecks) {
    record.review = { override: true, overridden_checks: input.overriddenChecks };
  }
  return record;
}
