import { Logger } from '@aws-lambda-powertools/logger';

// Every function logs an allow-list of fields only: IDs, statuses, counts and timings.
// Never pass names, dates, document numbers, chat messages or model output (PRIV-1).
export const logger = new Logger({ serviceName: 'lost-found-workshop' });
