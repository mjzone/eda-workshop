import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeNic, nicBirthDate } from '../functions/validate-fields/src/rules/nic';

describe('nicBirthDate', () => {
  it('decodes the worked example from the slides', () => {
    assert.deepEqual(nicBirthDate('905431234V'), { date: '1990-02-12', sex: 'F' });
    assert.deepEqual(nicBirthDate('199054301234'), { date: '1990-02-12', sex: 'F' });
  });

  it('reads male numbers and lower-case letters', () => {
    assert.deepEqual(nicBirthDate('851240567v'), { date: '1985-05-03', sex: 'M' });
    assert.deepEqual(nicBirthDate('198512405678'), { date: '1985-05-03', sex: 'M' });
    assert.deepEqual(nicBirthDate('851240567X'), { date: '1985-05-03', sex: 'M' });
  });

  it('counts February as 29 days in every year', () => {
    assert.equal(nicBirthDate('920590000V')?.date, '1992-02-28'); // day 59
    assert.equal(nicBirthDate('920600000V')?.date, '1992-02-29'); // day 60, leap year
    assert.equal(nicBirthDate('920610000V')?.date, '1992-03-01'); // day 61
    assert.equal(nicBirthDate('910590000V')?.date, '1991-02-28');
    assert.equal(nicBirthDate('910610000V')?.date, '1991-03-01');
  });

  it('rejects 29 February in a non-leap year', () => {
    assert.deepEqual(decodeNic('910600000V'), { ok: false, code: 'NIC_DAY_INVALID' });
    assert.deepEqual(decodeNic('199156000000'), { ok: false, code: 'NIC_DAY_INVALID' }); // female, day 60
  });

  it('rejects impossible day numbers', () => {
    for (const day of ['000', '367', '500', '867']) {
      assert.deepEqual(decodeNic(`90${day}1234V`), { ok: false, code: 'NIC_DAY_INVALID' }, day);
    }
    assert.equal(nicBirthDate('903661234V')?.date, '1990-12-31'); // day 366
  });

  it('rejects malformed numbers', () => {
    for (const nic of ['90543123V', '9054312345V', '905431234Z', '19905430123', 'ABCDEFGHIJKL']) {
      assert.deepEqual(decodeNic(nic), { ok: false, code: 'NIC_FORMAT' }, nic);
    }
  });
});
