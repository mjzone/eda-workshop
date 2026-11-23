import { App, Tags } from 'aws-cdk-lib';
import { loadConfig, STACK_NAMES } from '../config';
import { FindMyDocumentStack } from '../lib/find-my-document-stack';
import { FoundDocumentsStack } from '../lib/found-documents-stack';

const config = loadConfig();
const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: config.REGION };

const found = new FoundDocumentsStack(app, STACK_NAMES.foundDocuments, {
  env,
  config,
  description: 'Lost passport and NIC finder: register a found document (flow 1)',
});

new FindMyDocumentStack(app, STACK_NAMES.findMyDocument, {
  env,
  config,
  table: found.table,
  description: 'Lost passport and NIC finder: find my document (flow 2)',
});

Tags.of(app).add('project', 'lost-found-workshop');
