// The register-found-document workflow, stage 2, written in JSONata.
//
//   KeyValid? -> ClaimItem -> ExtractFields -> ValidateFields -> ChecksPassed? -> SaveRecord -> Done
//                    |                                               |
//                    v                                               v
//            AlreadyProcessing                                  ChecksFailed
//
// Stage 3 replaces ChecksFailed with a review by a security officer.

import { Duration } from 'aws-cdk-lib';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import type { Config } from '../../config';
import { modelResourceArns } from './bedrock-models';
import { nodeFunction } from './node-function';

export interface RegisterWorkflowProps {
  bucket: IBucket;
  table: ITable;
  config: Config;
}

const LAMBDA_RETRY: sfn.RetryProps = {
  errors: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException', 'Lambda.SdkClientException', 'ThrottlingException'],
  interval: Duration.seconds(2),
  maxAttempts: 3,
  backoffRate: 2,
  jitterStrategy: sfn.JitterType.FULL,
};

const DYNAMODB_RETRY: sfn.RetryProps = {
  errors: [
    'DynamoDB.ProvisionedThroughputExceededException',
    'DynamoDB.ThrottlingException',
    'DynamoDB.RequestLimitExceeded',
    'DynamoDB.InternalServerErrorException',
    'DynamoDB.InternalServerError',
  ],
  interval: Duration.seconds(2),
  maxAttempts: 3,
  backoffRate: 2,
  jitterStrategy: sfn.JitterType.FULL,
};

export class RegisterWorkflow extends Construct {
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: RegisterWorkflowProps) {
    super(scope, id);
    const { bucket, table, config } = props;

    // ---- Lambda functions --------------------------------------------------------------
    const extractFn = nodeFunction(this, 'ExtractFieldsFunction', {
      folder: 'extract-fields',
      description: 'Reads the photos of a found document with a multimodal model on Bedrock',
      timeout: Duration.seconds(90),
      environment: { EXTRACTION_MODEL_ID: config.EXTRACTION_MODEL_ID },
    });
    bucket.grantRead(extractFn, 'found/*');
    extractFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: modelResourceArns(this, config.EXTRACTION_MODEL_ID, config.INFERENCE_REGIONS.split(',')),
      }),
    );

    const validateFn = nodeFunction(this, 'ValidateFieldsFunction', {
      folder: 'validate-fields',
      description: 'Checks the extracted fields with plain TypeScript and builds the record',
      environment: {
        PASSPORT_NUMBER_PATTERN: config.PASSPORT_NUMBER_PATTERN,
        RECORD_TTL_DAYS: String(config.RECORD_TTL_DAYS),
        COLLECTION_POINT: config.COLLECTION_POINT,
      },
    });

    // ---- States ------------------------------------------------------------------------
    const done = sfn.Succeed.jsonata(this, 'Done');
    const alreadyProcessing = sfn.Succeed.jsonata(this, 'AlreadyProcessing', {
      comment: 'A duplicate event for an item that is already claimed or saved',
    });
    const invalidKey = sfn.Fail.jsonata(this, 'InvalidKey', {
      error: 'InvalidKey',
      cause: 'The object key is not found/{ULID}/manifest.json',
    });
    const checksFailed = sfn.Fail.jsonata(this, 'ChecksFailed', {
      error: 'ChecksFailed',
      cause: 'A check failed. In stage 3, an officer reviews the item instead.',
    });

    // Claim the item before any model call, so a duplicate event stops here (ING-8).
    const claimItem = new sfn.CustomState(this, 'ClaimItem', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:putItem',
        Arguments: {
          TableName: table.tableName,
          Item: {
            item_id: { S: '{% $itemId %}' },
            status: { S: 'PROCESSING' },
            execution_id: { S: '{% $states.context.Execution.Id %}' },
            expires_at: { N: '{% $string($floor($toMillis($now()) / 1000) + 259200) %}' },
          },
          ConditionExpression: 'attribute_not_exists(item_id)',
        },
        Output: '{% $states.input %}',
      },
    });
    claimItem.addRetry(DYNAMODB_RETRY);
    claimItem.addCatch(alreadyProcessing, { errors: ['DynamoDB.ConditionalCheckFailedException'] });

    const extractFields = tasks.LambdaInvoke.jsonata(this, 'ExtractFields', {
      lambdaFunction: extractFn,
      payload: sfn.TaskInput.fromObject({
        bucket: '{% $bucket %}',
        manifest_key: '{% $manifestKey %}',
        item_id: '{% $itemId %}',
      }),
      outputs: '{% $states.result.Payload %}',
      assign: { extraction: '{% $states.result.Payload %}' },
      retryOnServiceExceptions: false,
    });
    extractFields.addRetry(LAMBDA_RETRY);

    const validateFields = tasks.LambdaInvoke.jsonata(this, 'ValidateFields', {
      lambdaFunction: validateFn,
      payload: sfn.TaskInput.fromObject({
        item_id: '{% $itemId %}',
        manifest_document_type: '{% $extraction.manifest_document_type %}',
        extraction: '{% $extraction.extraction %}',
        extraction_error: '{% $extraction.extraction_error %}',
      }),
      outputs: '{% $states.result.Payload %}',
      retryOnServiceExceptions: false,
    });
    validateFields.addRetry(LAMBDA_RETRY);

    // Only the execution that claimed the item may write the record.
    const saveRecord = new sfn.CustomState(this, 'SaveRecord', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:putItem',
        Arguments: {
          TableName: table.tableName,
          Item: '{% $states.input.record_item %}',
          ConditionExpression: '#status = :processing AND execution_id = :me',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':processing': { S: 'PROCESSING' },
            ':me': { S: '{% $states.context.Execution.Id %}' },
          },
        },
        Output: {
          item_id: '{% $itemId %}',
          reference: '{% $states.input.record_item.reference.S %}',
        },
      },
    });
    saveRecord.addRetry(DYNAMODB_RETRY);
    saveRecord.addCatch(done, { errors: ['DynamoDB.ConditionalCheckFailedException'] });

    const checksPassed = sfn.Choice.jsonata(this, 'ChecksPassed?')
      .when(sfn.Condition.jsonata('{% $states.input.valid %}'), saveRecord.next(done))
      .otherwise(checksFailed);

    const keyValid = sfn.Choice.jsonata(this, 'KeyValid?')
      .when(
        sfn.Condition.jsonata(`{% $contains($states.input.key, /^found\\/[0-9A-HJKMNP-TV-Z]{26}\\/manifest\\.json$/) %}`),
        claimItem.next(extractFields).next(validateFields).next(checksPassed),
        {
          assign: {
            bucket: '{% $states.input.bucket %}',
            manifestKey: '{% $states.input.key %}',
            itemId: '{% $split($states.input.key, "/")[1] %}',
          },
        },
      )
      .otherwise(invalidKey);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      stateMachineName: 'register-found-document',
      stateMachineType: sfn.StateMachineType.STANDARD,
      queryLanguage: sfn.QueryLanguage.JSONATA,
      definitionBody: sfn.DefinitionBody.fromChainable(keyValid),
      comment: 'Registers a found passport or NIC: extract, check, save',
    });
    this.stateMachine.addToRolePolicy(
      new PolicyStatement({ actions: ['dynamodb:PutItem'], resources: [table.tableArn] }),
    );
  }
}
