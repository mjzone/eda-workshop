// ExtractFields (step 3): reads the item's pages from S3 and asks a multimodal model on
// Amazon Bedrock to read the document. The model answers by calling one tool, so the
// output always has the same shape. See docs/requirements.md, section 5.4.

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ToolInputSchema,
} from '@aws-sdk/client-bedrock-runtime';
import { imageSize } from 'image-size';
import { z } from 'zod';
import { logger } from '../shared/logger';

const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});
const MODEL_ID = process.env.EXTRACTION_MODEL_ID!;
const MAX_BYTES = 3.75 * 1024 * 1024;
const MAX_EDGE = 1600;

const Manifest = z.object({
  item_id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  document_type: z.enum(['PASSPORT', 'NIC']),
  files: z.array(z.string()).min(1).max(4),
  uploaded_at: z.string(),
});

const nullableString = z.string().nullable();
const Fields = z.object({
  document_type: z.enum(['PASSPORT', 'NIC', 'UNKNOWN']).nullable(),
  full_name: nullableString,
  date_of_birth: nullableString,
  sex: z.enum(['M', 'F']).nullable(),
  nic_number: nullableString,
  passport_number: nullableString,
  mrz_line1: nullableString,
  mrz_line2: nullableString,
  confidence: z.enum(['high', 'medium', 'low']),
});

const TOOL_NAME = 'record_extracted_fields';
const nullable = (description: string) => ({ type: ['string', 'null'], description });
const TOOL_SCHEMA = {
  type: 'object',
  required: Object.keys(Fields.shape),
  properties: {
    document_type: { type: ['string', 'null'], enum: ['PASSPORT', 'NIC', 'UNKNOWN', null], description: 'What the photos show' },
    full_name: nullable('Full name in English letters, exactly as printed'),
    date_of_birth: nullable('Date of birth as YYYY-MM-DD'),
    sex: { type: ['string', 'null'], enum: ['M', 'F', null], description: 'Sex as printed' },
    nic_number: nullable('NIC number exactly as printed, including a final V or X'),
    passport_number: nullable('Passport number exactly as printed'),
    mrz_line1: nullable('First machine-readable line of a passport, character for character, including every <'),
    mrz_line2: nullable('Second machine-readable line of a passport, character for character, including every <'),
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'low if any photo is blurred, cropped or partly unreadable' },
  },
};

const PROMPT = `These photos show one identity document that was found in a building: either the data page of a passport, or the front and back of a Sri Lankan national identity card (NIC).

Read what is printed, then answer only by calling ${TOOL_NAME}, once. Don't write any other text.
- Copy every value exactly as printed. Do not correct, complete or reformat numbers.
- Write the full name in English letters as printed on the document.
- Write the date of birth as YYYY-MM-DD.
- For a passport, copy both machine-readable lines at the bottom exactly, character for character, including every "<".
- Use null for any field you cannot read with certainty. Never guess a value that is not clearly printed.
- Set document_type to what you see in the photos.
- Set confidence to "low" if any photo is blurred, cropped or partly unreadable.`;

export interface ExtractRequest {
  bucket: string;
  manifest_key: string;
  item_id: string;
}

async function getObject(bucket: string, key: string): Promise<Uint8Array> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return response.Body!.transformToByteArray();
}

function imageFormat(bytes: Uint8Array): 'jpeg' | 'png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return null;
}

function pageProblem(bytes: Uint8Array): string | null {
  if (!imageFormat(bytes)) return 'not a JPEG or PNG';
  if (bytes.byteLength > MAX_BYTES) return 'larger than 3.75 MB';
  const { width = 0, height = 0 } = imageSize(bytes);
  if (Math.max(width, height) > MAX_EDGE) return `long edge over ${MAX_EDGE} px`;
  return null;
}

async function askModel(images: ContentBlock[]) {
  const response = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: 'user', content: [...images, { text: PROMPT }] }],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: TOOL_NAME,
              description: 'Records the fields read from the identity document.',
              inputSchema: { json: TOOL_SCHEMA } as ToolInputSchema,
            },
          },
        ],
        // Newer models reject a forced tool choice ("tool" or "any") with a ValidationException,
        // so the model chooses and the prompt asks for the tool only. If it answers in text
        // instead, the schema check in the handler fails and the model is asked once more.
        toolChoice: { auto: {} },
      },
      inferenceConfig: { temperature: 0, maxTokens: 1024 },
    }),
  );
  const toolUse = response.output?.message?.content?.find((block) => block.toolUse)?.toolUse;
  return { input: toolUse?.input, usage: response.usage };
}

export const handler = async (event: ExtractRequest) => {
  const started = Date.now();
  const manifest = Manifest.parse(JSON.parse(new TextDecoder().decode(await getObject(event.bucket, event.manifest_key))));
  if (manifest.item_id !== event.item_id) throw new Error('Manifest item_id does not match the object key');

  const prefix = `found/${manifest.item_id}/`;
  const base = {
    item_id: manifest.item_id,
    manifest_document_type: manifest.document_type,
    page_keys: manifest.files,
  };

  const images: ContentBlock[] = [];
  for (const key of manifest.files) {
    if (!key.startsWith(prefix)) return { ...base, extraction: null, extraction_error: true, reason: 'page outside the item folder' };
    const bytes = await getObject(event.bucket, key);
    const problem = pageProblem(bytes);
    if (problem) {
      logger.warn('Page rejected', { item_id: manifest.item_id, reason: problem });
      return { ...base, extraction: null, extraction_error: true, reason: problem };
    }
    images.push({ image: { format: imageFormat(bytes)!, source: { bytes } } });
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { input, usage } = await askModel(images);
    const parsed = Fields.safeParse(input);
    logger.info('Model answered', {
      item_id: manifest.item_id,
      pages: images.length,
      attempt,
      parsed: parsed.success,
      latency_ms: Date.now() - started,
      input_tokens: usage?.inputTokens,
      output_tokens: usage?.outputTokens,
    });
    if (parsed.success) return { ...base, extraction: parsed.data, extraction_error: false };
  }
  return { ...base, extraction: null, extraction_error: true, reason: 'model output did not match the schema' };
};
