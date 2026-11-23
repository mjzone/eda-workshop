// CDK assertion tests for flow 1 (stage 1: the bucket, the rule and a placeholder workflow).

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { loadConfig } from '../infra/config';
import { FoundDocumentsStack } from '../infra/lib/found-documents-stack';

let template: Template;

before(() => {
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new FoundDocumentsStack(app, 'FoundDocumentsStack', {
    env: { account: '111111111111', region: 'us-east-1' },
    config: loadConfig({}),
  });
  template = Template.fromStack(stack);
});

function stateMachine() {
  const [sm] = Object.values(template.findResources('AWS::StepFunctions::StateMachine'));
  const definition = sm.Properties.DefinitionString;
  if (typeof definition === 'string') return JSON.parse(definition);
  const parts = definition['Fn::Join'][1] as unknown[];
  return JSON.parse(parts.map((p) => (typeof p === 'string' ? p : 'TOKEN')).join(''));
}

describe('FoundDocumentsStack', () => {
  it('sends the bucket’s events to EventBridge', () => {
    template.hasResourceProperties('Custom::S3BucketNotifications', {
      NotificationConfiguration: { EventBridgeConfiguration: {} },
    });
  });

  it('starts the workflow only for manifest.json', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.s3'],
        'detail-type': ['Object Created'],
        detail: { object: { key: [{ suffix: 'manifest.json' }] } },
      },
    });
  });

  it('keeps the bucket private and TLS-only', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } })]),
      },
    });
  });

  it('checks the key, then runs the placeholder step', () => {
    const definition = stateMachine();
    assert.equal(definition.QueryLanguage, 'JSONata');
    assert.equal(definition.StartAt, 'KeyValid?');
    assert.equal(definition.States['KeyValid?'].Choices[0].Next, 'Received');
    assert.equal(definition.States['KeyValid?'].Default, 'InvalidKey');
  });
});
