// Flow 1: register a found document (steps 1 to 5) and the shared table.

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { EventField, Match, Rule, RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { Config } from '../config';
import { RegisterWorkflow } from './constructs/register-workflow';

export interface FoundDocumentsStackProps extends StackProps {
  config: Config;
}

export class FoundDocumentsStack extends Stack {
  readonly table: Table;

  constructor(scope: Construct, id: string, props: FoundDocumentsStackProps) {
    super(scope, id, props);
    const { config } = props;

    // Step 1: security uploads the photos and then manifest.json under found/{itemId}/.
    const bucket = new Bucket(this, 'FoundItems', {
      eventBridgeEnabled: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      lifecycleRules: [
        { prefix: 'found/', expiration: Duration.days(config.IMAGE_RETENTION_DAYS) },
        { prefix: 'reviews/', expiration: Duration.days(2) },
      ],
    });

    // Step 5: the table both flows share. It holds only what matching needs (REC-1).
    this.table = new Table(this, 'FoundDocuments', {
      tableName: 'found-documents',
      partitionKey: { name: 'item_id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.table.addGlobalSecondaryIndex({
      indexName: 'by_dob',
      partitionKey: { name: 'date_of_birth', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // Steps 3 and 4: the workflow.
    const workflow = new RegisterWorkflow(this, 'RegisterWorkflow', { bucket, table: this.table, config });

    // Step 2: S3 sends one "Object Created" event per object. Only the manifest starts a run.
    new Rule(this, 'ManifestUploaded', {
      description: 'Starts the workflow when a manifest.json is uploaded',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [bucket.bucketName] },
          object: { key: Match.suffix('manifest.json') },
        },
      },
      targets: [
        new SfnStateMachine(workflow.stateMachine, {
          input: RuleTargetInput.fromObject({
            bucket: EventField.fromPath('$.detail.bucket.name'),
            key: EventField.fromPath('$.detail.object.key'),
          }),
        }),
      ],
    });

    new CfnOutput(this, 'FoundItemsBucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'StateMachineArn', { value: workflow.stateMachine.stateMachineArn });
    new CfnOutput(this, 'TableName', { value: this.table.tableName });
  }
}
