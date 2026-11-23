import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { marshall } from '@aws-sdk/util-dynamodb';
import { EMPTY_FIELDS, type ExtractedFields } from '../functions/validate-fields/src/rules/checks';
import { idLast4, last4Digits } from '../functions/validate-fields/src/rules/record';
import { validate } from '../functions/validate-fields/src/validate';

const config = {
  passportPattern: /^[A-Z]\d{7}$/,
  recordTtlDays: 30,
  collectionPoint: 'Security desk, ground floor',
  now: new Date('2026-11-23T10:00:00Z'),
  random: () => 0.5,
};

const nic = (overrides: Partial<ExtractedFields> = {}): ExtractedFields => ({
  ...EMPTY_FIELDS,
  document_type: 'NIC',
  full_name: 'SPECIMEN PERSON',
  date_of_birth: '1990-02-12',
  sex: 'F',
  nic_number: '905431234V',
  confidence: 'high',
  ...overrides,
});

const request = (extraction: ExtractedFields | null, extra = {}) => ({
  item_id: '01JD3Q8Z9X7M2K4N6P8R0T2V4W',
  manifest_document_type: 'NIC' as const,
  extraction,
  extraction_error: extraction === null,
  ...extra,
});

describe('id_last4', () => {
  it('takes the last four digits and ignores letters', () => {
    assert.equal(last4Digits('N1234567'), '4567');
    assert.equal(last4Digits('901234678V'), '4678');
    assert.equal(last4Digits('199054301234'), '1234');
    assert.deepEqual(idLast4({ nic_number: '905431234V', passport_number: 'N1234567' }), ['1234', '4567']);
  });
});

describe('validate', () => {
  it('passes a clean NIC and builds a minimal record', () => {
    const result = validate(request(nic()), config);
    assert.equal(result.valid, true);
    assert.deepEqual(result.failed_checks, []);
    const record = result.record!;
    assert.equal(record.name_normalized, 'SPECIMEN PERSON');
    assert.deepEqual([...record.id_last4], ['1234']);
    assert.match(record.reference, /^LF-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(record.expires_at, Math.floor(config.now.getTime() / 1000) + 30 * 86400);
    // No full numbers, sex or MRZ in the record (REC-1).
    const stored = JSON.stringify(marshall(record));
    assert.ok(!stored.includes('905431234V'));
    assert.ok(!('sex' in record));
  });

  it('sends a birth-date mismatch to review', () => {
    const result = validate(request(nic({ date_of_birth: '1990-02-13' })), config);
    assert.equal(result.valid, false);
    assert.deepEqual(result.failed_checks, [{ code: 'NIC_DOB_MISMATCH', kind: 'overridable' }]);
    assert.equal(result.record, undefined);
  });

  it('lets an officer override overridable checks and records the override', () => {
    const result = validate(
      request(nic({ date_of_birth: '1990-02-13' }), { officer: { decision: 'APPROVE', fields: {} } }),
      config,
    );
    assert.equal(result.valid, true);
    assert.deepEqual(result.record!.review, { override: true, overridden_checks: ['NIC_DOB_MISMATCH'] });
  });

  it('never lets an officer override a format check', () => {
    const result = validate(
      request(nic(), { officer: { decision: 'APPROVE', fields: { nic_number: '12345' } } }),
      config,
    );
    assert.equal(result.valid, false);
    assert.ok(result.failed_checks.some((c) => c.code === 'NIC_FORMAT' && c.kind === 'format'));
  });

  it('accepts the officer’s corrected fields', () => {
    const result = validate(
      request(nic({ date_of_birth: '1990-02-13' }), { officer: { decision: 'APPROVE', fields: { date_of_birth: '1990-02-12' } } }),
      config,
    );
    assert.equal(result.valid, true);
    assert.deepEqual(result.record!.review, { override: true, overridden_checks: [] });
  });

  it('treats an extraction error as overridable and missing fields as format checks', () => {
    const result = validate(request(null), config);
    const codes = result.failed_checks.map((c) => `${c.code}:${c.kind}`);
    assert.deepEqual(codes, ['EXTRACTION_ERROR:overridable', 'MISSING_NAME:format', 'MISSING_DOB:format', 'MISSING_ID:format']);
  });

  it('flags low confidence, a document-type mismatch and a future birth date', () => {
    const result = validate(request(nic({ confidence: 'low', document_type: 'PASSPORT', date_of_birth: '2030-01-01' })), config);
    const codes = result.failed_checks.map((c) => c.code);
    assert.ok(codes.includes('LOW_CONFIDENCE'));
    assert.ok(codes.includes('DOC_TYPE_MISMATCH'));
    assert.ok(codes.includes('DOB_FORMAT'));
  });
});
