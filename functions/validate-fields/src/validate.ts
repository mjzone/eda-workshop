// The pure core of ValidateFields: runs the checks and, when the item passes, builds the
// record. The handler (index.ts) only adds configuration, the clock and marshalling.

import { EMPTY_FIELDS, normalizeDate, runChecks, type DocumentType, type ExtractedFields, type FailedCheck } from './rules/checks';
import { buildRecord, type FoundDocumentRecord } from './rules/record';

export interface OfficerDecision {
  decision: 'APPROVE';
  fields?: Partial<ExtractedFields>;
}

export interface ValidateRequest {
  item_id: string;
  manifest_document_type: DocumentType;
  extraction: ExtractedFields | null;
  extraction_error: boolean;
  officer?: OfficerDecision | null;
}

export interface ValidateConfig {
  passportPattern: RegExp;
  recordTtlDays: number;
  collectionPoint: string;
  now: Date;
  random: () => number;
}

export interface ValidateResult {
  valid: boolean;
  officer_mode: boolean;
  fields: ExtractedFields;
  failed_checks: FailedCheck[];
  record?: FoundDocumentRecord;
}

export function validate(request: ValidateRequest, config: ValidateConfig): ValidateResult {
  const officerMode = request.officer?.decision === 'APPROVE';
  const fields: ExtractedFields = {
    ...EMPTY_FIELDS,
    ...(request.extraction ?? {}),
    ...(officerMode ? request.officer?.fields ?? {} : {}),
  };
  // Some models copy the card's separators instead of writing YYYY-MM-DD.
  fields.date_of_birth = normalizeDate(fields.date_of_birth);

  const failed = runChecks({
    manifestType: request.manifest_document_type,
    fields,
    extractionError: request.extraction_error,
    passportPattern: config.passportPattern,
    today: config.now,
  });

  const formatFailures = failed.filter((c) => c.kind === 'format');
  const valid = officerMode ? formatFailures.length === 0 : failed.length === 0;

  const result: ValidateResult = { valid, officer_mode: officerMode, fields, failed_checks: failed };
  if (valid) {
    result.record = buildRecord({
      itemId: request.item_id,
      documentType: request.manifest_document_type,
      fields,
      now: config.now,
      random: config.random,
      recordTtlDays: config.recordTtlDays,
      collectionPoint: config.collectionPoint,
      overriddenChecks: officerMode ? failed.map((c) => c.code) : undefined,
    });
  }
  return result;
}
