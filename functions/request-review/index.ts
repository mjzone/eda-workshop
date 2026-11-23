// RequestOfficerReview (step 4): the workflow pauses here with a task token. This
// function writes reviews/{itemId}.json so the desk CLI can find the request, then
// returns. The run continues only when the desk sends the token back.

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { logger } from '../shared/logger';

const s3 = new S3Client({});
const BUCKET = process.env.FOUND_ITEMS_BUCKET!;

export interface ReviewRequest {
  task_token: string;
  execution_arn: string;
  item_id: string;
  manifest_document_type: string;
  page_keys: string[];
  fields: Record<string, unknown>;
  failed_checks: { code: string; kind: string }[];
}

export const handler = async (event: ReviewRequest) => {
  const body = { ...event, created_at: new Date().toISOString() };
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `reviews/${event.item_id}.json`,
      Body: JSON.stringify(body, null, 2),
      ContentType: 'application/json',
    }),
  );
  logger.info('Review requested', {
    item_id: event.item_id,
    failed_checks: event.failed_checks.map((c) => c.code),
  });
  return { requested: true };
};
