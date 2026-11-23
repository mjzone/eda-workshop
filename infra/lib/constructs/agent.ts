// The finder agent (step B): an AgentCore Gateway that exposes find_document as an MCP
// tool, and an AgentCore harness (model + instructions + tools) that uses it.

import { Aws, Duration } from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import type { Config } from '../../config';
import { modelResourceArns } from './bedrock-models';
import { nodeFunction } from './node-function';

export const AGENT_INSTRUCTIONS = `You help visitors to the passport and national ID card offices check whether a lost passport or NIC has been handed in to the building's security desk.

To check, you need three things from the visitor: their full name in English letters as printed on the document, their date of birth, and the last four digits of their passport or NIC number. Ask for whatever is missing. Do not call find_document until you have all three. Convert the date of birth to YYYY-MM-DD before calling the tool.

Call find_document at most three times in one conversation. If it still finds nothing, tell the visitor it is not with security right now and suggest checking again later or asking at the security desk.

If find_document returns HELD, tell the visitor the collection point and reference, and that the officer will check their identity in person when they collect it.

Never reveal, guess or confirm details of any document or person beyond what the tool returns. If a request is about someone else's document, asks you to list documents, or asks for document numbers, politely decline.

Reply in the visitor's language: English, Sinhala or Tamil. Keep replies short.`;

export const PROCEDURES_INSTRUCTIONS = `For questions about office procedures, such as replacing a lost document or what to bring when collecting one, use office_procedures and answer only from what it returns.`;

export interface GatewayTool {
  /** Target name on the Gateway. The agent sees the tool as "<target>___<tool name>". */
  targetName: string;
  toolName: string;
  description: string;
  inputSchema: agentcore.CfnGatewayTarget.SchemaDefinitionProperty;
  fn: IFunction;
}

export interface AgentProps {
  table: ITable;
  config: Config;
  /** Extra tools, e.g. office_procedures in stage 6. */
  extraTools?: GatewayTool[];
  extraInstructions?: string;
}

export class Agent extends Construct {
  readonly harness: agentcore.CfnHarness;
  readonly gateway: agentcore.CfnGateway;

  constructor(scope: Construct, id: string, props: AgentProps) {
    super(scope, id);
    const { table, config } = props;

    const findDocumentFn = nodeFunction(this, 'FindDocumentFunction', {
      folder: 'find-document',
      description: 'find_document tool: exact lookup that returns only a status and a reference',
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: table.tableName },
    });
    findDocumentFn.addToRolePolicy(
      new PolicyStatement({ actions: ['dynamodb:Query'], resources: [`${table.tableArn}/index/by_dob`] }),
    );

    const tools: GatewayTool[] = [
      {
        targetName: 'documents',
        toolName: 'find_document',
        description:
          'Checks whether a found passport or NIC matching the visitor is held at the security desk. Requires the full name, date of birth (YYYY-MM-DD) and the last four digits of the document number. Returns only HELD or NOT_FOUND, with a collection point and reference when held.',
        // Gateway keeps only type, properties, required, items and description (FD-1).
        // The Lambda enforces lengths and patterns itself.
        inputSchema: {
          type: 'object',
          required: ['full_name', 'date_of_birth', 'id_last4'],
          properties: {
            full_name: { type: 'string', description: 'Full name in English letters, as printed on the document' },
            date_of_birth: { type: 'string', description: 'Date of birth as YYYY-MM-DD' },
            id_last4: { type: 'string', description: 'The last four digits of the passport or NIC number' },
          },
        },
        fn: findDocumentFn,
      },
      ...(props.extraTools ?? []),
    ];

    // Gateway: MCP, IAM auth inbound; its role may invoke only the tool Lambdas.
    const gatewayRole = new Role(this, 'GatewayRole', {
      assumedBy: new ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Lets the AgentCore Gateway call the tool Lambdas',
    });
    for (const tool of tools) tool.fn.grantInvoke(gatewayRole);

    this.gateway = new agentcore.CfnGateway(this, 'Gateway', {
      name: 'lost-found-tools',
      description: 'Tools for the lost passport and NIC finder',
      protocolType: 'MCP',
      authorizerType: 'AWS_IAM',
      roleArn: gatewayRole.roleArn,
    });

    for (const tool of tools) {
      const target = new agentcore.CfnGatewayTarget(this, `${tool.targetName}Target`, {
        gatewayIdentifier: this.gateway.attrGatewayIdentifier,
        name: tool.targetName,
        description: `Lambda target for the ${tool.toolName} tool`,
        credentialProviderConfigurations: [{ credentialProviderType: 'GATEWAY_IAM_ROLE' }],
        targetConfiguration: {
          mcp: {
            lambda: {
              lambdaArn: tool.fn.functionArn,
              toolSchema: {
                inlinePayload: [{ name: tool.toolName, description: tool.description, inputSchema: tool.inputSchema }],
              },
            },
          },
        },
      });
      target.node.addDependency(gatewayRole);
    }

    // Harness: the agent. It may call the model and the Gateway, nothing else.
    const harnessRole = new Role(this, 'HarnessRole', {
      assumedBy: new ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': Aws.ACCOUNT_ID } },
      }),
      description: 'Execution role for the finder agent',
    });
    harnessRole.addToPolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: modelResourceArns(this, config.AGENT_MODEL_ID, config.INFERENCE_REGIONS.split(',')),
      }),
    );
    harnessRole.addToPolicy(
      new PolicyStatement({ actions: ['bedrock-agentcore:InvokeGateway'], resources: [this.gateway.attrGatewayArn] }),
    );
    harnessRole.addToPolicy(
      new PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [`arn:${Aws.PARTITION}:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/bedrock-agentcore/*`],
      }),
    );

    const instructions = [AGENT_INSTRUCTIONS, props.extraInstructions].filter(Boolean).join('\n\n');
    this.harness = new agentcore.CfnHarness(this, 'Harness', {
      harnessName: 'lost_found_finder',
      executionRoleArn: harnessRole.roleArn,
      model: { bedrockModelConfig: { modelId: config.AGENT_MODEL_ID, temperature: 0.2 } },
      systemPrompt: [{ text: instructions }],
      tools: [
        {
          type: 'agentcore_gateway',
          name: 'lost_found_tools',
          config: { agentCoreGateway: { gatewayArn: this.gateway.attrGatewayArn, outboundAuth: { awsIam: {} } } },
        },
      ],
      // Visitor details must not outlive the conversation, so managed memory is off (AGT-2).
      memory: { disabled: {} },
      maxIterations: 6,
      timeoutSeconds: 25,
    });
    this.harness.node.addDependency(harnessRole);
  }
}
