// Flow 2: find my document (steps A to C).

import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import type { Config } from '../config';
import { Agent } from './constructs/agent';
import { ChatApi } from './constructs/chat-api';
import { Guardrail } from './constructs/guardrail';

export interface FindMyDocumentStackProps extends StackProps {
  config: Config;
  table: ITable;
}

export class FindMyDocumentStack extends Stack {
  constructor(scope: Construct, id: string, props: FindMyDocumentStackProps) {
    super(scope, id, props);
    const { config, table } = props;

    // Step B: the agent and its one lookup tool, find_document.
    const agent = new Agent(this, 'Agent', { table, config });

    // Step A: the chat API and the proxy.
    const chat = new ChatApi(this, 'Chat', {
      harnessArn: agent.harness.attrArn,
      agentRuntimeArn: agent.harness.attrEnvironmentAgentCoreRuntimeEnvironmentAgentRuntimeArn,
      config,
    });

    // Step C: the guardrail, applied by the proxy on the way in and on the way out.
    const guardrail = new Guardrail(this, 'Guardrail', { config });
    chat.useGuardrail(guardrail.guardrail.attrGuardrailId, guardrail.applyArns);

    new CfnOutput(this, 'ChatApiUrl', { value: chat.api.urlForPath('/chat') });
    new CfnOutput(this, 'ApiKeyId', { value: chat.apiKey.keyId });
    new CfnOutput(this, 'HarnessArn', { value: agent.harness.attrArn });
    new CfnOutput(this, 'GatewayId', { value: agent.gateway.attrGatewayIdentifier });
    new CfnOutput(this, 'GuardrailId', { value: guardrail.guardrail.attrGuardrailId });
  }
}
