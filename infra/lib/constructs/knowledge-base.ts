// Optional, stage 6: a Bedrock Knowledge Base of the offices' procedure PDFs, stored in
// S3 Vectors, and the office_procedures tool that searches it. RAG for knowledge.

import { Aws, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { CfnDataSource, CfnKnowledgeBase } from 'aws-cdk-lib/aws-bedrock';
import { Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { CfnIndex, CfnVectorBucket } from 'aws-cdk-lib/aws-s3vectors';
import { Construct } from 'constructs';
import type { Config } from '../../config';
import type { GatewayTool } from './agent';
import { nodeFunction } from './node-function';

export class KnowledgeBase extends Construct {
  readonly docsBucket: Bucket;
  readonly knowledgeBase: CfnKnowledgeBase;
  readonly dataSource: CfnDataSource;
  readonly tool: GatewayTool;

  constructor(scope: Construct, id: string, props: { config: Config }) {
    super(scope, id);
    const { config } = props;

    this.docsBucket = new Bucket(this, 'ProcedureDocs', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const vectorBucket = new CfnVectorBucket(this, 'VectorBucket', {});
    const index = new CfnIndex(this, 'VectorIndex', {
      vectorBucketArn: vectorBucket.attrVectorBucketArn,
      indexName: 'procedures',
      dataType: 'float32',
      dimension: 1024,
      distanceMetric: 'cosine',
      metadataConfiguration: { nonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT', 'AMAZON_BEDROCK_METADATA'] },
    });

    const embeddingModelArn = `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}::foundation-model/${config.EMBEDDING_MODEL_ID}`;
    const role = new Role(this, 'KnowledgeBaseRole', {
      assumedBy: new ServicePrincipal('bedrock.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': Aws.ACCOUNT_ID } },
      }),
    });
    const policy = new Policy(this, 'KnowledgeBasePolicy', {
      roles: [role],
      statements: [
        new PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: [embeddingModelArn] }),
        new PolicyStatement({ actions: ['s3:ListBucket'], resources: [this.docsBucket.bucketArn] }),
        new PolicyStatement({ actions: ['s3:GetObject'], resources: [this.docsBucket.arnForObjects('*')] }),
        new PolicyStatement({
          actions: ['s3vectors:PutVectors', 's3vectors:GetVectors', 's3vectors:DeleteVectors', 's3vectors:QueryVectors', 's3vectors:GetIndex'],
          resources: [index.attrIndexArn],
        }),
      ],
    });

    this.knowledgeBase = new CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: 'lost-found-procedures',
      description: 'Public procedure guides of the passport and NIC offices',
      roleArn: role.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn,
          embeddingModelConfiguration: { bedrockEmbeddingModelConfiguration: { dimensions: 1024, embeddingDataType: 'FLOAT32' } },
        },
      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: { vectorBucketArn: vectorBucket.attrVectorBucketArn, indexArn: index.attrIndexArn },
      },
    });
    this.knowledgeBase.node.addDependency(policy);

    this.dataSource = new CfnDataSource(this, 'ProcedureDocsSource', {
      knowledgeBaseId: this.knowledgeBase.attrKnowledgeBaseId,
      name: 'procedure-docs',
      dataSourceConfiguration: { type: 'S3', s3Configuration: { bucketArn: this.docsBucket.bucketArn } },
    });

    const fn = nodeFunction(this, 'OfficeProceduresFunction', {
      folder: 'office-procedures',
      description: 'office_procedures tool: searches the procedure Knowledge Base',
      timeout: Duration.seconds(15),
      environment: { KNOWLEDGE_BASE_ID: this.knowledgeBase.attrKnowledgeBaseId },
    });
    fn.addToRolePolicy(new PolicyStatement({ actions: ['bedrock:Retrieve'], resources: [this.knowledgeBase.attrKnowledgeBaseArn] }));

    this.tool = {
      targetName: 'procedures',
      toolName: 'office_procedures',
      description:
        'Searches the public procedure guides of the passport and NIC offices, for example how to replace a lost document or what to bring when collecting one. Returns passages with their source.',
      inputSchema: {
        type: 'object',
        required: ['question'],
        properties: { question: { type: 'string', description: 'The visitor’s question about a procedure' } },
      },
      fn,
    };
  }
}
