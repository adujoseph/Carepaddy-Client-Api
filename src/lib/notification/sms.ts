import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { env } from '@config/env';
import { logger } from '@lib/logger';

function createSnsClient(): SNSClient {
  if (env.awsAccessKeyId && env.awsSecretAccessKey) {
    return new SNSClient({
      region: env.awsRegion,
      credentials: {
        accessKeyId: env.awsAccessKeyId,
        secretAccessKey: env.awsSecretAccessKey,
      },
    });
  }
  return new SNSClient({ region: env.awsRegion });
}

const snsClient = createSnsClient();

function hasAwsCredentials(): boolean {
  return Boolean(env.awsAccessKeyId && env.awsSecretAccessKey);
}

export async function sendSms(to: string, message: string): Promise<void> {
  if (!hasAwsCredentials()) {
    logger.warn({ to }, 'sms not sent — AWS credentials missing');
    throw new Error('SMS service is not configured');
  }

  try {
    await snsClient.send(
      new PublishCommand({
        PhoneNumber: to,
        Message: message,
        MessageAttributes: {
          'AWS.SNS.SMS.SenderID': {
            DataType: 'String',
            StringValue: env.snsSenderId,
          },
        },
      }),
    );
  } catch (err) {
    logger.error({ err, to }, 'SNS sendSms failed');
    throw err;
  }

  logger.info({ to }, 'sms sent via SNS');
}
