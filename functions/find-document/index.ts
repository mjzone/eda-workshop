// find_document (step B): the agent's only way to look at records. AgentCore Gateway
// calls this Lambda with the tool's arguments as the event. It does an exact lookup on
// the by_dob index and returns only a status, a collection point and references.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../shared/logger';
import { matchRecords, parseInput, type StoredRecord } from './src/find';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME!;

export const handler = async (event: unknown) => {
  const parsed = parseInput(event);
  if (!parsed.ok) {
    logger.info('find_document', { status: parsed.result.status });
    return parsed.result;
  }

  const response = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'by_dob',
      KeyConditionExpression: 'date_of_birth = :dob',
      ExpressionAttributeValues: { ':dob': parsed.input.date_of_birth },
    }),
  );
  const candidates = (response.Items ?? []) as StoredRecord[];
  const result = matchRecords(parsed.input, candidates);
  logger.info('find_document', { status: result.status, candidates: candidates.length });
  return result;
};
