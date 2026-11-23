// npm run kb-sync  (stage 6) indexes the PDFs in the procedure-docs bucket. It does the
// same as Knowledge Base › Data source › Sync in the Bedrock console.

import { setTimeout as sleep } from 'node:timers/promises';
import { BedrockAgentClient, GetIngestionJobCommand, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import { region, requireOutput, runCli } from '../shared/stack-outputs';

runCli(async () => {
  const knowledgeBaseId = await requireOutput('findMyDocument', 'KnowledgeBaseId');
  const dataSourceId = await requireOutput('findMyDocument', 'DataSourceId');
  const bucket = await requireOutput('findMyDocument', 'ProcedureDocsBucketName');
  const client = new BedrockAgentClient({ region });

  console.log(`Syncing the PDFs in s3://${bucket} ...`);
  const started = await client.send(new StartIngestionJobCommand({ knowledgeBaseId, dataSourceId }));
  const jobId = started.ingestionJob!.ingestionJobId!;
  for (;;) {
    await sleep(5000);
    const { ingestionJob } = await client.send(new GetIngestionJobCommand({ knowledgeBaseId, dataSourceId, ingestionJobId: jobId }));
    const status = ingestionJob?.status;
    if (status === 'COMPLETE' || status === 'FAILED' || status === 'STOPPED') {
      console.log(`Sync ${status.toLowerCase()}.`, ingestionJob?.statistics ?? '', ingestionJob?.failureReasons ?? '');
      return;
    }
    process.stdout.write('.');
  }
});
