// CDK assertion tests for flow 2 (stage 4: the chat API and the agent).
// The Lambdas are not bundled, which keeps this fast.

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { loadConfig } from '../infra/config';
import { FindMyDocumentStack } from '../infra/lib/find-my-document-stack';
import { FoundDocumentsStack } from '../infra/lib/found-documents-stack';

let template: Template;

before(() => {
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const env = { account: '111111111111', region: 'us-east-1' };
  const config = loadConfig({});
  const found = new FoundDocumentsStack(app, 'FoundDocumentsStack', { env, config });
  template = Template.fromStack(new FindMyDocumentStack(app, 'FindMyDocumentStack', { env, config, table: found.table }));
});

describe('FindMyDocumentStack', () => {
  it('requires an API key on POST /chat', () => {
    template.hasResourceProperties('AWS::ApiGateway::Method', { HttpMethod: 'POST', ApiKeyRequired: true });
  });

  it('gives the agent find_document through the Gateway, with IAM auth', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Gateway', { ProtocolType: 'MCP', AuthorizerType: 'AWS_IAM' });
    template.hasResourceProperties('AWS::BedrockAgentCore::GatewayTarget', {
      Name: 'documents',
      TargetConfiguration: { Mcp: { Lambda: { ToolSchema: { InlinePayload: [Match.objectLike({ Name: 'find_document' })] } } } },
    });
  });

  it('turns managed memory off for the agent', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Harness', { Memory: { Disabled: {} } });
  });

  it('keeps every log group for 3 days', () => {
    const groups = Object.values(template.findResources('AWS::Logs::LogGroup'));
    assert.ok(groups.length > 0);
    for (const group of groups) assert.equal(group.Properties.RetentionInDays, 3);
  });

  it('never grants Bedrock, AgentCore or DynamoDB actions on "*"', () => {
    for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
      for (const statement of policy.Properties.PolicyDocument.Statement) {
        const actions = [statement.Action].flat() as string[];
        if (actions.some((a) => /^(bedrock|bedrock-agentcore|dynamodb):/.test(a))) {
          assert.ok(![statement.Resource].flat().includes('*'), JSON.stringify(statement));
        }
      }
    }
  });
});
