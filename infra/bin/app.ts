import { App, Tags } from 'aws-cdk-lib';
import { loadConfig, STACK_NAMES } from '../config';
import { FoundDocumentsStack } from '../lib/found-documents-stack';

const config = loadConfig();
const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: config.REGION };

new FoundDocumentsStack(app, STACK_NAMES.foundDocuments, {
  env,
  config,
  description: 'Lost passport and NIC finder: register a found document (flow 1)',
});

Tags.of(app).add('project', 'lost-found-workshop');
