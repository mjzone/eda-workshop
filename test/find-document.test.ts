import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchRecords, parseInput } from '../functions/find-document/src/find';

const records = [
  {
    status: 'HELD',
    name_normalized: 'PERSON SPECIMEN',
    id_last4: new Set(['4567']),
    reference: 'LF-7Q2K',
    collection_point: 'Security desk, ground floor',
  },
  { status: 'PROCESSING', name_normalized: 'PERSON SPECIMEN', id_last4: new Set(['4567']), reference: 'LF-AAAA' },
];

const input = { full_name: 'Specimen Person', date_of_birth: '1990-02-12', id_last4: '4567' };

describe('find_document', () => {
  it('returns HELD with only the collection point and reference', () => {
    const result = matchRecords(input, records);
    assert.deepEqual(result, { status: 'HELD', collection_point: 'Security desk, ground floor', references: ['LF-7Q2K'] });
  });

  it('never echoes names, dates or digits, and gives no hint on a miss', () => {
    for (const attempt of [input, { ...input, id_last4: '0000' }, { ...input, full_name: 'Someone Else' }]) {
      const text = JSON.stringify(matchRecords(attempt, records));
      for (const secret of ['SPECIMEN', 'PERSON', 'Specimen', '1990', '4567', '0000']) {
        assert.ok(!text.includes(secret), `${text} contains ${secret}`);
      }
    }
    assert.deepEqual(matchRecords({ ...input, id_last4: '0000' }, records), { status: 'NOT_FOUND' });
    assert.deepEqual(matchRecords({ ...input, full_name: 'Someone Else' }, records), { status: 'NOT_FOUND' });
  });

  it('ignores claim rows that are still processing', () => {
    assert.deepEqual(matchRecords(input, [records[1]]), { status: 'NOT_FOUND' });
  });

  it('explains format problems without saying anything about matching', () => {
    const parsed = parseInput({ ...input, date_of_birth: '12/02/1990' });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.deepEqual(parsed.result, { status: 'INVALID_INPUT', field: 'date_of_birth', expected: 'a date in YYYY-MM-DD form' });
  });
});
