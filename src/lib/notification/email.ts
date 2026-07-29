import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { env } from '@config/env';
import { logger } from '@lib/logger';

function createSesClient(): SESClient {
  if (env.awsAccessKeyId && env.awsSecretAccessKey) {
    return new SESClient({
      region: env.awsRegion,
      credentials: {
        accessKeyId: env.awsAccessKeyId,
        secretAccessKey: env.awsSecretAccessKey,
      },
    });
  }
  return new SESClient({ region: env.awsRegion });
}

const sesClient = createSesClient();

function hasAwsCredentials(): boolean {
  return Boolean(env.awsAccessKeyId && env.awsSecretAccessKey);
}

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  if (!hasAwsCredentials()) {
    logger.warn({ to, subject }, 'email not sent — AWS credentials missing');
    throw new Error('Email service is not configured');
  }

  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: env.sesFromEmail,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject },
          Body: {
            Text: { Data: body },
            Html: {
              Data: `<p>${body.replace(/\n/g, '<br/>')}</p>`,
            },
          },
        },
      }),
    );
  } catch (err) {
    logger.error({ err, to, subject }, 'SES sendEmail failed');
    throw err;
  }

  logger.info({ to, subject }, 'email sent via SES');
}
