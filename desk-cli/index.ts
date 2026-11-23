// Security desk CLI. Run it with npm:
//
//   npm run desk upload-specimen nic_old_valid     upload a specimen from test-data/specimens
//   npm run desk upload nic front.jpg back.jpg     upload your own photos (JPEG, PNG or PDF)
//   npm run desk seed                              upload every specimen
//   npm run desk reviews                           list items waiting for an officer
//   npm run desk review <ITEM_ID>                  approve, correct or reject one
//   npm run desk find <REFERENCE>                  find an item at handover
//   npm run desk collected <REFERENCE>             delete the record after handover

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { SFNClient, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { region, requireOutput, runCli, UserError } from '../shared/stack-outputs';
import { MAX_PAGES, normalizeFile } from './normalize';

const SPECIMENS = resolve(__dirname, '..', 'test-data', 'specimens');
const s3 = new S3Client({ region });
const sfn = new SFNClient({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

type DocumentType = 'PASSPORT' | 'NIC';

const bucketName = () => requireOutput('foundDocuments', 'FoundItemsBucketName');
const tableName = () => requireOutput('foundDocuments', 'TableName');

async function readJson<T>(bucket: string, key: string): Promise<T> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return JSON.parse(await response.Body!.transformToString()) as T;
}

function parseType(value: string | undefined): DocumentType {
  const type = value?.toUpperCase();
  if (type === 'PASSPORT' || type === 'NIC') return type;
  throw new UserError('The document type must be "passport" or "nic".');
}

// ---- upload --------------------------------------------------------------------------

async function upload(type: DocumentType, files: string[]): Promise<string> {
  if (files.length === 0) throw new UserError('Give at least one file to upload.');
  const pages = (await Promise.all(files.map(normalizeFile))).flat();
  if (pages.length > MAX_PAGES) throw new UserError(`An item can have at most ${MAX_PAGES} pages; these files make ${pages.length}.`);

  const bucket = await bucketName();
  const itemId = ulid();
  const keys: string[] = [];
  for (const [i, page] of pages.entries()) {
    const key = `found/${itemId}/page-${i + 1}.jpg`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: page, ContentType: 'image/jpeg' }));
    keys.push(key);
  }
  // The manifest goes last, so when its event starts the workflow every page is there.
  const manifest = { item_id: itemId, document_type: type, files: keys, uploaded_at: new Date().toISOString() };
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `found/${itemId}/manifest.json`,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }),
  );
  console.log(`Uploaded ${type} with ${keys.length} page(s) and a manifest. Item ID: ${itemId}`);
  return itemId;
}

async function specimenNames(): Promise<string[]> {
  const files = (await readdir(SPECIMENS)).filter((f) => f.endsWith('.png'));
  return [...new Set(files.map((f) => f.replace(/_(front|back)\.png$|\.png$/, '')))].sort();
}

async function uploadSpecimen(name: string | undefined) {
  const names = await specimenNames();
  if (!name || !names.includes(name)) {
    throw new UserError(`Choose a specimen: ${names.join(', ')}`);
  }
  const files = (await readdir(SPECIMENS))
    .filter((f) => f === `${name}.png` || f === `${name}_front.png` || f === `${name}_back.png`)
    .sort((a, b) => (a.includes('_back') ? 1 : 0) - (b.includes('_back') ? 1 : 0))
    .map((f) => join(SPECIMENS, f));
  const type: DocumentType = name.startsWith('passport') ? 'PASSPORT' : 'NIC';
  await upload(type, files);
  console.log('Watch it in the AWS console: Step Functions › State machines › register-found-document.');
}

async function seed() {
  for (const name of await specimenNames()) await uploadSpecimen(name);
}

// ---- reviews -------------------------------------------------------------------------

interface ReviewFile {
  task_token: string;
  item_id: string;
  manifest_document_type: DocumentType;
  page_keys: string[];
  fields: Record<string, string | null>;
  failed_checks: { code: string; kind: 'format' | 'overridable' }[];
  created_at: string;
}

const EDITABLE_FIELDS = ['full_name', 'date_of_birth', 'sex', 'nic_number', 'passport_number', 'mrz_line2'] as const;

function age(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

async function listReviews() {
  const bucket = await bucketName();
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'reviews/' }));
  const keys = (listed.Contents ?? []).map((o) => o.Key!).filter((k) => k.endsWith('.json'));
  if (keys.length === 0) {
    console.log('No items are waiting for review.');
    return;
  }
  const rows = await Promise.all(keys.map((k) => readJson<ReviewFile>(bucket, k)));
  console.table(
    rows.map((r) => ({
      item_id: r.item_id,
      type: r.manifest_document_type,
      failed_checks: r.failed_checks.map((c) => c.code).join(', '),
      waiting: age(r.created_at),
    })),
  );
  console.log('Open one with: npm run desk review <ITEM_ID>');
}

async function downloadPages(bucket: string, review: ReviewFile) {
  const dir = resolve('.review-pages', review.item_id);
  await mkdir(dir, { recursive: true });
  for (const key of review.page_keys) {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const file = join(dir, key.split('/').pop()!);
    await writeFile(file, await response.Body!.transformToByteArray());
    console.log(`  saved ${file}`);
  }
}

async function sendDecision(token: string, output: object) {
  try {
    await sfn.send(new SendTaskSuccessCommand({ taskToken: token, output: JSON.stringify(output) }));
    return true;
  } catch (error) {
    const name = (error as Error).name;
    if (name === 'TaskTimedOut' || name === 'InvalidToken' || name === 'TaskDoesNotExist') {
      console.log('That run is no longer waiting (it timed out or was already decided).');
      return false;
    }
    throw error;
  }
}

async function review(itemId: string | undefined) {
  if (!itemId) throw new UserError('Give the item ID: npm run desk review <ITEM_ID>  (see npm run desk reviews)');
  const { input, select } = await import('@inquirer/prompts');
  const bucket = await bucketName();
  const key = `reviews/${itemId}.json`;
  let request: ReviewFile;
  try {
    request = await readJson<ReviewFile>(bucket, key);
  } catch {
    throw new UserError(`No review is waiting for ${itemId}. List them with: npm run desk reviews`);
  }

  console.log(`\nItem ${itemId} (${request.manifest_document_type}), waiting ${age(request.created_at)}`);
  console.log('\nFailed checks:');
  for (const c of request.failed_checks) {
    console.log(`  ${c.code}  ${c.kind === 'format' ? '(format: must be fixed)' : '(an officer can override)'}`);
  }
  console.log('\nWhat the model read:');
  console.table(Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, request.fields?.[f] ?? '—'])));

  for (;;) {
    const action = await select({
      message: 'What do you want to do?',
      choices: [
        { name: 'Save the photos to look at them', value: 'pages' },
        { name: 'Approve as it is', value: 'approve' },
        { name: 'Correct the fields, then approve', value: 'edit' },
        { name: 'Reject', value: 'reject' },
        { name: 'Decide later', value: 'later' },
      ],
    });
    if (action === 'later') return;
    if (action === 'pages') {
      await downloadPages(bucket, request);
      continue;
    }

    let output: object;
    if (action === 'reject') {
      output = { decision: 'REJECT', reason: await input({ message: 'Reason:', default: 'Not a valid document' }) };
    } else {
      const fields: Record<string, string | null> = { ...request.fields };
      if (action === 'edit') {
        for (const f of EDITABLE_FIELDS) {
          const value = await input({ message: `${f} (leave empty for none):`, default: request.fields?.[f] ?? '' });
          fields[f] = value.trim() === '' ? null : value.trim();
        }
      }
      output = { decision: 'APPROVE', fields };
    }

    const sent = await sendDecision(request.task_token, output);
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    if (sent) console.log('Sent. Watch the run continue in the graph view.');
    return;
  }
}

// ---- handover ------------------------------------------------------------------------

async function findByReference(reference: string | undefined) {
  if (!reference) throw new UserError('Give the reference, for example LF-7Q2K.');
  const table = await tableName();
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: '#ref = :ref',
        ExpressionAttributeNames: { '#ref': 'reference' },
        ExpressionAttributeValues: { ':ref': reference.toUpperCase() },
        ExclusiveStartKey: startKey,
      }),
    );
    if (page.Items?.length) return page.Items[0];
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  throw new UserError(`No record has the reference ${reference}.`);
}

async function find(reference: string | undefined) {
  const item = await findByReference(reference);
  console.log(`Item ${item.item_id} (${item.document_type}), registered ${item.registered_at}`);
  console.log(`Photos: ${item.image_prefix}`);
  console.log('Check the visitor against the photo on the document before you hand it over.');
}

async function collected(reference: string | undefined) {
  const item = await findByReference(reference);
  const bucket = await bucketName();
  await ddb.send(new DeleteCommand({ TableName: await tableName(), Key: { item_id: item.item_id } }));
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: item.image_prefix }));
  const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }));
  if (objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
  console.log(`Handed over. Deleted the record and ${objects.length} file(s) for ${reference}.`);
}

// ---- main ----------------------------------------------------------------------------

const HELP = `Security desk CLI

  npm run desk upload-specimen <name>         upload a specimen (see test-data/specimens)
  npm run desk upload <passport|nic> <files>  upload your own photos (JPEG, PNG or PDF)
  npm run desk seed                           upload every specimen
  npm run desk reviews                        list items waiting for an officer
  npm run desk review <ITEM_ID>               approve, correct or reject one
  npm run desk find <REFERENCE>               find an item at handover
  npm run desk collected <REFERENCE>          delete the record after handover`;

runCli(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { type: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  const [command, ...rest] = positionals;
  switch (command) {
    case 'upload-specimen':
      return uploadSpecimen(rest[0]);
    case 'upload': {
      // Either "upload nic a.jpg b.jpg" or "upload --type nic a.jpg b.jpg".
      const type = parseType(values.type ?? rest[0]);
      await upload(type, values.type ? rest : rest.slice(1));
      return;
    }
    case 'seed':
      return seed();
    case 'reviews':
      return listReviews();
    case 'review':
      return review(rest[0]);
    case 'find':
      return find(rest[0]);
    case 'collected':
      return collected(rest[0]);
    default:
      console.log(HELP);
  }
});
