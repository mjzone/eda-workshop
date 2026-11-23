// npm run chat:web  writes chat-web/config.js (git-ignored) with the API URL and key,
// then tells you which file to open in a browser.

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { APIGatewayClient, GetApiKeyCommand } from '@aws-sdk/client-api-gateway';
import { region, requireOutput, runCli } from '../shared/stack-outputs';

runCli(async () => {
  const apiUrl = await requireOutput('findMyDocument', 'ChatApiUrl');
  const apiKeyId = await requireOutput('findMyDocument', 'ApiKeyId');
  const key = await new APIGatewayClient({ region }).send(new GetApiKeyCommand({ apiKey: apiKeyId, includeValue: true }));
  const file = resolve(__dirname, '..', 'chat-web', 'config.js');
  await writeFile(file, `window.CHAT_CONFIG = ${JSON.stringify({ apiUrl, apiKey: key.value }, null, 2)};\n`);
  console.log(`Wrote ${file}`);
  console.log(`Open ${resolve(__dirname, '..', 'chat-web', 'index.html')} in your browser.`);
});
