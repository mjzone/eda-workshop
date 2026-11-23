import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { resolve } from 'node:path';

export interface NodeFunctionProps {
  /** Folder under functions/, e.g. "extract-fields". */
  folder: string;
  description: string;
  environment?: Record<string, string>;
  timeout?: Duration;
  memorySize?: number;
}

/**
 * A TypeScript Lambda function bundled by esbuild (no Docker), on Node.js 22 and arm64.
 * The AWS SDK clients are bundled too, which pins their versions. The log group is
 * created by the stack with 3-day retention, so destroying the stack deletes it.
 */
export function nodeFunction(scope: Construct, id: string, props: NodeFunctionProps): NodejsFunction {
  const logGroup = new LogGroup(scope, `${id}Logs`, {
    retention: RetentionDays.THREE_DAYS,
    removalPolicy: RemovalPolicy.DESTROY,
  });
  return new NodejsFunction(scope, id, {
    entry: resolve(__dirname, '..', '..', '..', 'functions', props.folder, 'index.ts'),
    handler: 'handler',
    description: props.description,
    runtime: Runtime.NODEJS_22_X,
    architecture: Architecture.ARM_64,
    memorySize: props.memorySize ?? 512,
    timeout: props.timeout ?? Duration.seconds(30),
    environment: props.environment,
    logGroup,
    bundling: {
      externalModules: [],
      minify: true,
      target: 'node22',
    },
  });
}
