// Chat proxy (steps A and C). For each message:
//   1. ApplyGuardrail on the visitor's message (source INPUT)   - when a guardrail exists
//   2. InvokeHarness: the AgentCore agent answers, calling find_document if it needs to
//   3. ApplyGuardrail on the agent's answer (source OUTPUT)     - when a guardrail exists
// The guardrail sits here, at the boundary where text enters and leaves the system.

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BedrockAgentCoreClient, InvokeHarnessCommand } from '@aws-sdk/client-bedrock-agentcore';
import { ApplyGuardrailCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { logger } from '../shared/logger';

const agentcore = new BedrockAgentCoreClient({});
const bedrock = new BedrockRuntimeClient({});
const HARNESS_ARN = process.env.HARNESS_ARN!;
const GUARDRAIL_ID = process.env.GUARDRAIL_ID; // set from stage 5
const GUARDRAIL_VERSION = process.env.GUARDRAIL_VERSION ?? 'DRAFT';
const AGENT_TIMEOUT_MS = 25_000;

const Body = z.object({
  session_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  message: z.string().min(1).max(1000),
});

const TRY_AGAIN = 'Sorry, that took too long. Please try again, or ask at the security desk.';

function reply(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,x-api-key',
    },
    body: JSON.stringify(body),
  };
}

async function guardrail(source: 'INPUT' | 'OUTPUT', text: string): Promise<{ intervened: boolean; text: string }> {
  if (!GUARDRAIL_ID) return { intervened: false, text };
  const result = await bedrock.send(
    new ApplyGuardrailCommand({
      guardrailIdentifier: GUARDRAIL_ID,
      guardrailVersion: GUARDRAIL_VERSION,
      source,
      content: [{ text: { text } }],
    }),
  );
  if (result.action !== 'GUARDRAIL_INTERVENED') return { intervened: false, text };
  return { intervened: true, text: result.outputs?.map((o) => o.text).join('\n') || text };
}

async function askAgent(sessionId: string, message: string): Promise<string> {
  const response = await agentcore.send(
    // Only the harness ARN, the session and the message. Never forward model, tools or
    // system prompt overrides (PRX-3).
    new InvokeHarnessCommand({
      harnessArn: HARNESS_ARN,
      runtimeSessionId: sessionId,
      messages: [{ role: 'user', content: [{ text: message }] }],
    }),
    { abortSignal: AbortSignal.timeout(AGENT_TIMEOUT_MS) },
  );

  // The stream holds every assistant message of the agent loop: the tool call, then the
  // final answer. Keep the text of the last message that has any.
  let current = '';
  let last = '';
  for await (const event of response.stream ?? []) {
    if (event.messageStart) current = '';
    else if (event.contentBlockDelta?.delta?.text) current += event.contentBlockDelta.delta.text;
    else if (event.messageStop && current.trim()) last = current;
    else if (event.validationException || event.internalServerException || event.runtimeClientError) {
      throw new Error('The agent returned an error event');
    }
  }
  return (last || current).trim();
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const started = Date.now();
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(JSON.parse(event.body ?? '{}'));
  } catch {
    return reply(400, { error: 'Send JSON with session_id (a UUID) and message (1 to 1000 characters).' });
  }
  const log = (result: string, extra: object = {}) =>
    logger.info('Chat turn', { session_id: body.session_id, result, latency_ms: Date.now() - started, ...extra });

  const input = await guardrail('INPUT', body.message);
  if (input.intervened) {
    log('input_blocked', { guardrail: 'INPUT' });
    return reply(200, { session_id: body.session_id, reply: input.text, guardrail_intervened: true });
  }

  let answer: string;
  try {
    answer = await askAgent(body.session_id, body.message);
  } catch (error) {
    const timedOut = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
    log(timedOut ? 'timeout' : 'agent_error', { error: (error as Error).name });
    return reply(200, { session_id: body.session_id, reply: TRY_AGAIN, guardrail_intervened: false });
  }

  const output = await guardrail('OUTPUT', answer);
  log(output.intervened ? 'output_masked' : 'ok', { guardrail: GUARDRAIL_ID ? 'on' : 'off' });
  return reply(200, { session_id: body.session_id, reply: output.text, guardrail_intervened: output.intervened });
};
