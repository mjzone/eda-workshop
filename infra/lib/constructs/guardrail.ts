// Bedrock Guardrails (step C). The proxy applies it to every message in and every answer
// out. Personal-data filters run on output only: visitors must type their own name and
// date of birth, so filtering input would break the flow (GR-2).

import { Aws } from 'aws-cdk-lib';
import { CfnGuardrail } from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';
import type { Config } from '../../config';

const BLOCKED =
  'Sorry, I can’t help with that. Please rephrase your question, or ask at the security desk. | ' +
  'සමාවන්න, මට එයට උදව් කළ නොහැක. කරුණාකර නැවත අසන්න, නැතහොත් ආරක්ෂක මේසයෙන් විමසන්න. | ' +
  'மன்னிக்கவும், அதற்கு என்னால் உதவ முடியாது. மீண்டும் கேளுங்கள், அல்லது பாதுகாப்பு மேசையில் கேளுங்கள்.';

const OUTPUT_ONLY = { inputEnabled: false, outputEnabled: true, outputAction: 'ANONYMIZE' };

export class Guardrail extends Construct {
  readonly guardrail: CfnGuardrail;
  /** Resources to allow for bedrock:ApplyGuardrail. */
  readonly applyArns: string[];

  constructor(scope: Construct, id: string, props: { config: Config }) {
    super(scope, id);
    const { config } = props;
    const standard = config.GUARDRAIL_TIER === 'STANDARD';
    const profileArn = `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}:${Aws.ACCOUNT_ID}:guardrail-profile/${config.GUARDRAIL_PROFILE_ID}`;

    this.guardrail = new CfnGuardrail(this, 'Guardrail', {
      name: 'lost-found-chat',
      description: 'Blocks prompt attacks on input; masks ID numbers and contact details on output',
      blockedInputMessaging: BLOCKED,
      blockedOutputsMessaging: BLOCKED,
      contentPolicyConfig: {
        // The Standard tier detects prompt attacks in Sinhala and Tamil too (A-10).
        contentFiltersTierConfig: standard ? { tierName: 'STANDARD' } : undefined,
        filtersConfig: [{ type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' }],
      },
      crossRegionConfig: standard ? { guardrailProfileArn: profileArn } : undefined,
      sensitiveInformationPolicyConfig: {
        regexesConfig: [
          { name: 'NIC_OLD', description: 'Old-format NIC number', pattern: '\\b\\d{9}[VvXx]\\b', action: 'ANONYMIZE', ...OUTPUT_ONLY },
          { name: 'NIC_NEW', description: 'New-format NIC number', pattern: '\\b\\d{12}\\b', action: 'ANONYMIZE', ...OUTPUT_ONLY },
          { name: 'PASSPORT_NO', description: 'Passport number', pattern: '\\b[A-Z]\\d{7}\\b', action: 'ANONYMIZE', ...OUTPUT_ONLY },
        ],
        piiEntitiesConfig: ['ADDRESS', 'PHONE', 'EMAIL'].map((type) => ({ type, action: 'ANONYMIZE', ...OUTPUT_ONLY })),
      },
    });

    this.applyArns = standard ? [this.guardrail.attrGuardrailArn, profileArn] : [this.guardrail.attrGuardrailArn];
  }
}
