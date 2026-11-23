// The register-found-document workflow, stage 1: a placeholder.
//
//   KeyValid? -> Received -> Done
//       |
//       v
//   InvalidKey
//
// Stage 2 replaces "Received" with extraction, checks and saving the record.

import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

export class RegisterWorkflow extends Construct {
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const done = sfn.Succeed.jsonata(this, 'Done');
    const invalidKey = sfn.Fail.jsonata(this, 'InvalidKey', {
      error: 'InvalidKey',
      cause: 'The object key is not found/{ULID}/manifest.json',
    });

    // Placeholder step: shows which item arrived. Open a run's input and output to see the event.
    const received = sfn.Pass.jsonata(this, 'Received', {
      outputs: {
        item_id: '{% $itemId %}',
        bucket: '{% $bucket %}',
        manifest_key: '{% $manifestKey %}',
      },
    });

    // EventBridge passes {bucket, key}. The rule only matched the suffix, so check the whole key.
    const keyValid = sfn.Choice.jsonata(this, 'KeyValid?')
      .when(
        sfn.Condition.jsonata(`{% $contains($states.input.key, /^found\\/[0-9A-HJKMNP-TV-Z]{26}\\/manifest\\.json$/) %}`),
        received.next(done),
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
      comment: 'Registers a found passport or NIC (stage 1: placeholder)',
    });
  }
}
