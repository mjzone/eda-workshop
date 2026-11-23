// All configuration lives in .env (copy .env.example). Every value has a default, so a
// plain `npx cdk deploy --all` works with no .env at all. An invalid value fails the synth.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

const envFile = resolve(__dirname, '..', '.env');
if (existsSync(envFile)) loadEnv({ path: envFile, quiet: true });

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const positiveInt = z.coerce.number().int().positive();

const Schema = z
  .object({
    REGION: z.string().default('us-east-1'),
    EXTRACTION_MODEL_ID: z.string().default('us.anthropic.claude-sonnet-5-5'),
    AGENT_MODEL_ID: z.string().default('us.anthropic.claude-haiku-5-5'),
    EMBEDDING_MODEL_ID: z.string().default('amazon.titan-embed-text-v2:0'),
    INFERENCE_REGIONS: z.string().default('us-east-1,us-east-2,us-west-2'),
    GUARDRAIL_TIER: z.enum(['CLASSIC', 'STANDARD']).default('CLASSIC'),
    GUARDRAIL_PROFILE_ID: z.string().default('us.guardrail.v1:0'),
    COLLECTION_POINT: z.string().min(1).default('Security desk, ground floor'),
    ENABLE_KNOWLEDGE_BASE: bool.default(true),
    REVIEW_TIMEOUT_HOURS: positiveInt.default(24),
    RECORD_TTL_DAYS: positiveInt.default(30),
    IMAGE_RETENTION_DAYS: positiveInt.default(30),
    API_RATE: positiveInt.default(2),
    API_BURST: positiveInt.default(5),
    PASSPORT_NUMBER_PATTERN: z
      .string()
      .default('^[A-Z]\\d{7}$')
      .refine((p) => {
        try {
          new RegExp(p);
          return true;
        } catch {
          return false;
        }
      }, 'PASSPORT_NUMBER_PATTERN is not a valid regular expression'),
  })
  .refine((c) => c.IMAGE_RETENTION_DAYS >= c.RECORD_TTL_DAYS, {
    message: 'IMAGE_RETENTION_DAYS must be at least RECORD_TTL_DAYS, so photos outlive the record that points at them',
  });

export type Config = z.infer<typeof Schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = Schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join('.') || 'config'}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration in .env:\n${problems}`);
  }
  return result.data;
}

export const STACK_NAMES = {
  foundDocuments: 'FoundDocumentsStack',
  findMyDocument: 'FindMyDocumentStack',
} as const;
