// ValidateFields (step 3): checks the model's output with plain code and, when the item
// passes, returns the record in DynamoDB attribute-value form for SaveRecord.

import { randomInt } from 'node:crypto';
import { marshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../shared/logger';
import { validate, type ValidateRequest } from './src/validate';

const passportPattern = new RegExp(process.env.PASSPORT_NUMBER_PATTERN ?? '^[A-Z]\\d{7}$');
const recordTtlDays = Number(process.env.RECORD_TTL_DAYS ?? '30');
const collectionPoint = process.env.COLLECTION_POINT ?? 'Security desk, ground floor';

export const handler = async (event: ValidateRequest) => {
  const result = validate(event, {
    passportPattern,
    recordTtlDays,
    collectionPoint,
    now: new Date(),
    random: () => randomInt(0, 1_000_000) / 1_000_000,
  });

  logger.info('Validated item', {
    item_id: event.item_id,
    valid: result.valid,
    officer_mode: result.officer_mode,
    failed_checks: result.failed_checks.map((c) => c.code),
  });

  return {
    valid: result.valid,
    officer_mode: result.officer_mode,
    fields: result.fields,
    failed_checks: result.failed_checks,
    record_item: result.record ? marshall(result.record, { removeUndefinedValues: true }) : null,
  };
};
