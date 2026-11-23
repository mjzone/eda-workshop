import { Aws, Stack } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

const GEO_PREFIXES = ['us.', 'eu.', 'apac.', 'jp.', 'au.', 'ca.', 'global.'];

/**
 * The resources to allow for bedrock:InvokeModel on a model ID. A cross-Region inference
 * profile (us.anthropic...) needs both the profile ARN and the foundation model in every
 * Region the profile routes to (PRIV-5).
 */
export function modelResourceArns(scope: Construct, modelId: string, inferenceRegions: string[]): string[] {
  const region = Stack.of(scope).region;
  const prefix = GEO_PREFIXES.find((p) => modelId.startsWith(p));
  if (!prefix) return [`arn:${Aws.PARTITION}:bedrock:${region}::foundation-model/${modelId}`];

  const baseModel = modelId.slice(prefix.length);
  const regions = prefix === 'global.' ? ['*'] : inferenceRegions;
  return [
    `arn:${Aws.PARTITION}:bedrock:${region}:${Aws.ACCOUNT_ID}:inference-profile/${modelId}`,
    ...regions.map((r) => `arn:${Aws.PARTITION}:bedrock:${r}::foundation-model/${baseModel}*`),
  ];
}
