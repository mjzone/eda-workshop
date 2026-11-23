// Flow 2: find my document (steps A to C), plus the optional Knowledge Base (stage 6).

import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import type { Config } from '../config';
import { Agent, PROCEDURES_INSTRUCTIONS } from './constructs/agent';
import { ChatApi } from './constructs/chat-api';
import { Guardrail } from './constructs/guardrail';
import { KnowledgeBase } from './constructs/knowledge-base';

export interface FindMyDocumentStackProps extends StackProps {
  config: Config;
  table: ITable;
}

export class FindMyDocumentStack extends Stack {
  constructor(scope: Construct, id: string, props: FindMyDocumentStackProps) {
    super(scope, id, props);
    const { config, table } = props;

    // Stage 6 (optional): procedure questions through a Knowledge Base on S3 Vectors.
    const knowledgeBase = config.ENABLE_KNOWLEDGE_BASE ? new KnowledgeBase(this, 'Procedures', { config }) : undefined;

    // Step B: the agent and its one lookup tool, find_document.
    const agent = new Agent(this, 'Agent', {
      table,
      config,
      extraTools: knowledgeBase ? [knowledgeBase.tool] : [],
      extraInstructions: knowledgeBase ? PROCEDURES_INSTRUCTIONS : undefined,
    });

    // Step A: the chat API and the proxy.
    const chat = new ChatApi(this, 'Chat', { harnessArn: agent.harness.attrArn, config });

    // Step C: the guardrail, applied by the proxy on the way in and on the way out.
    const guardrail = new Guardrail(this, 'Guardrail', { config });
    chat.useGuardrail(guardrail.guardrail.attrGuardrailId, guardrail.applyArns);

    new CfnOutput(this, 'ChatApiUrl', { value: chat.api.urlForPath('/chat') });
    new CfnOutput(this, 'ApiKeyId', { value: chat.apiKey.keyId });
    new CfnOutput(this, 'HarnessArn', { value: agent.harness.attrArn });
    new CfnOutput(this, 'GatewayId', { value: agent.gateway.attrGatewayIdentifier });
    new CfnOutput(this, 'GuardrailId', { value: guardrail.guardrail.attrGuardrailId });
    if (knowledgeBase) {
      new CfnOutput(this, 'KnowledgeBaseId', { value: knowledgeBase.knowledgeBase.attrKnowledgeBaseId });
      new CfnOutput(this, 'DataSourceId', { value: knowledgeBase.dataSource.attrDataSourceId });
      new CfnOutput(this, 'ProcedureDocsBucketName', { value: knowledgeBase.docsBucket.bucketName });
    }
  }
}
