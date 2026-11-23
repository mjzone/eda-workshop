// Terminal chat with the finder agent:  npm run chat
// Type /new to start a new conversation, /quit to leave.

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { APIGatewayClient, GetApiKeyCommand } from '@aws-sdk/client-api-gateway';
import { region, requireOutput, runCli } from '../shared/stack-outputs';

async function chatSettings() {
  const apiUrl = await requireOutput('findMyDocument', 'ChatApiUrl');
  const apiKeyId = await requireOutput('findMyDocument', 'ApiKeyId');
  const key = await new APIGatewayClient({ region }).send(new GetApiKeyCommand({ apiKey: apiKeyId, includeValue: true }));
  return { apiUrl, apiKey: key.value! };
}

runCli(async () => {
  const { apiUrl, apiKey } = await chatSettings();
  const rl = createInterface({ input: stdin, output: stdout });
  let sessionId = randomUUID();
  console.log('Chat with the lost passport and NIC finder. Type /new for a new conversation, /quit to leave.\n');

  for (;;) {
    const message = (await rl.question('You: ')).trim();
    if (!message) continue;
    if (message === '/quit') break;
    if (message === '/new') {
      sessionId = randomUUID();
      console.log('(new conversation)\n');
      continue;
    }
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ session_id: sessionId, message }),
    });
    const body = (await response.json()) as { reply?: string; guardrail_intervened?: boolean; message?: string; error?: string };
    if (!response.ok) {
      console.log(`(error ${response.status}: ${body.message ?? body.error ?? 'unknown'})\n`);
      continue;
    }
    console.log(`Agent: ${body.reply}${body.guardrail_intervened ? '   [guardrail]' : ''}\n`);
  }
  rl.close();
});
