// npm run status  prints the last 10 runs of register-found-document.

import { ListExecutionsCommand, SFNClient } from '@aws-sdk/client-sfn';
import { region, requireOutput, runCli } from '../shared/stack-outputs';

runCli(async () => {
  const stateMachineArn = await requireOutput('foundDocuments', 'StateMachineArn');
  const result = await new SFNClient({ region }).send(new ListExecutionsCommand({ stateMachineArn, maxResults: 10 }));
  const rows = (result.executions ?? []).map((e) => ({
    started: e.startDate?.toLocaleTimeString(),
    status: e.status,
    seconds: e.stopDate && e.startDate ? Math.round((e.stopDate.getTime() - e.startDate.getTime()) / 1000) : '…',
    name: e.name,
  }));
  if (rows.length === 0) console.log('No runs yet. Upload something with: npm run desk upload-specimen passport_valid');
  else console.table(rows);
});
