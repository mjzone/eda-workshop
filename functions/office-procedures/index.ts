// office_procedures (optional, stage 6): searches the Knowledge Base of procedure PDFs.
// This is the job RAG is good at: general knowledge, not personal records.

import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { z } from 'zod';
import { logger } from '../shared/logger';

const client = new BedrockAgentRuntimeClient({});
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID!;
const Input = z.object({ question: z.string().trim().min(3).max(500) });

export const handler = async (event: unknown) => {
  const parsed = Input.safeParse(event);
  if (!parsed.success) return { status: 'INVALID_INPUT', field: 'question', expected: 'a question, 3 to 500 characters' };

  const response = await client.send(
    new RetrieveCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      retrievalQuery: { text: parsed.data.question },
      retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: 4 } },
    }),
  );
  const passages = (response.retrievalResults ?? []).map((r) => ({
    text: (r.content?.text ?? '').slice(0, 1500),
    source: r.location?.s3Location?.uri ?? 'unknown',
  }));
  logger.info('office_procedures', { passages: passages.length });
  return { passages };
};
