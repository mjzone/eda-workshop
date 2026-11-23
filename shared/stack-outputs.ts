// Shared by the desk CLI, the chat CLI and the scripts: reads the deployed stacks'
// outputs, so nobody has to copy bucket names, ARNs or API keys by hand.

import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { loadConfig, STACK_NAMES } from '../infra/config';

export const config = loadConfig();
export const region = config.REGION;

type StackKey = keyof typeof STACK_NAMES;

const WHERE: Record<string, string> = {
  FoundItemsBucketName: 'stage 1 (git checkout stage-1-events)',
  StateMachineArn: 'stage 1 (git checkout stage-1-events)',
  TableName: 'stage 2 (git checkout stage-2-extract)',
  ChatApiUrl: 'stage 4 (git checkout stage-4-agent)',
  ApiKeyId: 'stage 4 (git checkout stage-4-agent)',
  KnowledgeBaseId: 'stage 6 (git checkout stage-6-knowledge-base)',
  DataSourceId: 'stage 6 (git checkout stage-6-knowledge-base)',
  ProcedureDocsBucketName: 'stage 6 (git checkout stage-6-knowledge-base)',
};

export class UserError extends Error {}

const cache = new Map<string, Record<string, string>>();

export async function stackOutputs(stack: StackKey): Promise<Record<string, string>> {
  const name = STACK_NAMES[stack];
  if (cache.has(name)) return cache.get(name)!;
  const client = new CloudFormationClient({ region });
  let outputs: Record<string, string> = {};
  try {
    const result = await client.send(new DescribeStacksCommand({ StackName: name }));
    for (const o of result.Stacks?.[0]?.Outputs ?? []) if (o.OutputKey && o.OutputValue) outputs[o.OutputKey] = o.OutputValue;
  } catch (error) {
    const e = error as Error;
    if (e.name === 'ValidationError') outputs = {}; // the stack doesn't exist yet
    else if (e.name === 'CredentialsProviderError' || /credential/i.test(e.message)) {
      throw new UserError('No AWS credentials found. Configure them (for example with "aws configure" or "aws sso login") and try again.');
    } else throw error;
  }
  cache.set(name, outputs);
  return outputs;
}

/** An output's value, or a friendly error that says which stage adds it. */
export async function requireOutput(stack: StackKey, key: string): Promise<string> {
  const outputs = await stackOutputs(stack);
  if (outputs[key]) return outputs[key];
  const where = WHERE[key] ?? 'a later stage';
  throw new UserError(`${STACK_NAMES[stack]} has no ${key} yet. It is added in ${where}. Check out that branch and run: npx cdk deploy --all --require-approval never`);
}

/** Runs a CLI entry point and prints friendly errors instead of stack traces. */
export function runCli(main: () => Promise<void>) {
  main().catch((error: Error) => {
    if (error instanceof UserError) console.error(`\n${error.message}\n`);
    else if (error.name === 'ExitPromptError') console.error('\nCancelled.');
    else console.error(error);
    process.exitCode = 1;
  });
}
