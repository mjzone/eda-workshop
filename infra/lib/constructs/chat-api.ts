// The chat API (step A): API Gateway with an API key, and the proxy Lambda that sits
// between the visitor and the agent. From stage 5 the proxy also applies a guardrail.

import { Duration } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import type { Config } from '../../config';
import { nodeFunction } from './node-function';

export interface ChatApiProps {
  harnessArn: string;
  /** The AgentCore runtime the harness runs on. Calling the harness is also authorized on it. */
  agentRuntimeArn: string;
  config: Config;
}

const UUID_V4 = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

export class ChatApi extends Construct {
  readonly api: apigw.RestApi;
  readonly apiKey: apigw.IApiKey;
  readonly proxyFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: ChatApiProps) {
    super(scope, id);
    const { config } = props;

    this.proxyFn = nodeFunction(this, 'ChatProxyFunction', {
      folder: 'chat-proxy',
      description: 'Passes chat messages to the agent and applies the guardrail',
      timeout: Duration.seconds(28),
      environment: { HARNESS_ARN: props.harnessArn },
    });
    // Only this role may call the harness (SEC-1). The InvokeHarness API is authorized for two
    // IAM actions, InvokeHarness and InvokeAgentRuntime, on the harness, its endpoint and the
    // runtime it runs on. All four ARNs belong to this one harness. With the harness ARN alone,
    // every call fails with AccessDeniedException.
    this.proxyFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock-agentcore:InvokeHarness', 'bedrock-agentcore:InvokeAgentRuntime'],
        resources: [
          props.harnessArn,
          `${props.harnessArn}/harness-endpoint/*`,
          props.agentRuntimeArn,
          `${props.agentRuntimeArn}/runtime-endpoint/*`,
        ],
      }),
    );

    this.api = new apigw.RestApi(this, 'Api', {
      restApiName: 'lost-found-chat',
      description: 'Chat API for the lost passport and NIC finder',
      deployOptions: { stageName: 'prod' },
      // The chat page is opened from disk, so any origin is allowed (A-12).
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'x-api-key'],
      },
    });

    const model = this.api.addModel('ChatRequest', {
      contentType: 'application/json',
      schema: {
        type: apigw.JsonSchemaType.OBJECT,
        required: ['session_id', 'message'],
        properties: {
          session_id: { type: apigw.JsonSchemaType.STRING, pattern: UUID_V4 },
          message: { type: apigw.JsonSchemaType.STRING, minLength: 1, maxLength: 1000 },
        },
      },
    });

    this.api.root.addResource('chat').addMethod('POST', new apigw.LambdaIntegration(this.proxyFn), {
      apiKeyRequired: true,
      requestModels: { 'application/json': model },
      requestValidatorOptions: { validateRequestBody: true },
    });

    this.apiKey = this.api.addApiKey('ChatKey', { description: 'Workshop chat key' });
    const plan = this.api.addUsagePlan('ChatPlan', {
      throttle: { rateLimit: config.API_RATE, burstLimit: config.API_BURST },
    });
    plan.addApiKey(this.apiKey);
    plan.addApiStage({ stage: this.api.deploymentStage });
  }

  /** Stage 5: turn on the guardrail in the proxy. */
  useGuardrail(guardrailId: string, guardrailArns: string[]) {
    this.proxyFn.addEnvironment('GUARDRAIL_ID', guardrailId);
    this.proxyFn.addEnvironment('GUARDRAIL_VERSION', 'DRAFT');
    this.proxyFn.addToRolePolicy(new PolicyStatement({ actions: ['bedrock:ApplyGuardrail'], resources: guardrailArns }));
  }
}
