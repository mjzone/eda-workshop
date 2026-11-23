// CDK assertion tests for flow 1. The Lambdas are not bundled, which keeps this fast.

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

  it('checks the key, then claims the item before any model call', () => {
    const definition = stateMachine();
    assert.equal(definition.QueryLanguage, 'JSONata');
    assert.equal(definition.StartAt, 'KeyValid?');
    assert.equal(definition.States['KeyValid?'].Choices[0].Next, 'ClaimItem');
  });

  it('claims and saves with the DynamoDB integration, not a Lambda', () => {
    const states = stateMachine().States;
    for (const name of ['ClaimItem', 'SaveRecord']) {
      assert.equal(states[name].Resource, 'arn:aws:states:::dynamodb:putItem', name);
    }
  });

  it('waits for an officer with a task token when a check fails', () => {
    const states = stateMachine().States;
    assert.equal(states['ChecksPassed?'].Default, 'RequestOfficerReview');
    assert.ok(states.RequestOfficerReview.Resource.endsWith('lambda:invoke.waitForTaskToken'));
    assert.equal(states.RequestOfficerReview.Catch[0].Next, 'ReviewTimedOut');
    assert.equal(states['ReviewOutcome?'].Choices[0].Next, 'ValidateFields');
  });

  it('names the table found-documents with a by_dob index and a TTL', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'found-documents',
      TimeToLiveSpecification: { AttributeName: 'expires_at', Enabled: true },
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'by_dob' })],
    });
  });

  it('keeps every log group for 3 days', () => {
    const groups = Object.values(template.findResources('AWS::Logs::LogGroup'));
    assert.ok(groups.length > 0);
    for (const group of groups) assert.equal(group.Properties.RetentionInDays, 3);
  });

  it('never grants Bedrock or DynamoDB actions on "*"', () => {
    for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
      for (const statement of policy.Properties.PolicyDocument.Statement) {
        const actions = [statement.Action].flat() as string[];
        if (actions.some((a) => /^(bedrock|dynamodb):/.test(a))) {
          assert.ok(![statement.Resource].flat().includes('*'), JSON.stringify(statement));
        }
      }
    }
  });
});
