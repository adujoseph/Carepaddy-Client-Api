import { env } from '@config/env';
import { logger } from '@lib/logger';
import { prisma } from '@lib/prisma';
import { emailSender } from '../../../providers/notify.js';
import { runCqcCheckInBackground } from '../../../providers/cqc.provider.js';

/** SES sandbox allows ~1 message/second; keep bulk guardian notices under that. */
const BULK_SEND_INTERVAL_MS = 1100;
const SUPPORT_CONTACT = env.supportEmail;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendCarehomeInviteEmail(options: {
  to: string;
  carehomeName: string;
  token: string;
  expiresAt: Date;
}): Promise<boolean> {
  const link = `${env.clientPublicUrl}/accept-admin-invite?token=${encodeURIComponent(options.token)}`;
  try {
    await emailSender.send({
      to: options.to,
      subject: `Set up ${options.carehomeName} on CarePaddy`,
      body: [
        `Hello,`,
        ``,
        `${options.carehomeName} has been added to CarePaddy. This email address is the care home's administrator login.`,
        ``,
        `Activate your account and set your password:`,
        link,
        ``,
        `This link expires on ${options.expiresAt.toUTCString()}.`,
        ``,
        `— CarePaddy`,
      ].join('\n'),
    });
    return true;
  } catch (err) {
    logger.warn({ err, to: options.to }, 'carehome invite email failed');
    return false;
  }
}

export async function sendCarehomeEmailChangedNotice(options: {
  oldEmail: string;
  newEmail: string;
  carehomeName: string;
}) {
  try {
    await emailSender.send({
      to: options.oldEmail,
      subject: `The login email for ${options.carehomeName} was changed`,
      body: [
        `Hello,`,
        ``,
        `A CarePaddy administrator changed the login email for ${options.carehomeName} to ${options.newEmail}.`,
        `You have been signed out on all devices.`,
        ``,
        `If you did not expect this, contact ${SUPPORT_CONTACT} immediately.`,
        ``,
        `— CarePaddy`,
      ].join('\n'),
    });
  } catch (err) {
    logger.warn({ err }, 'carehome email-changed notice failed');
  }
}

type StatusChangeKind = 'deactivated' | 'reactivated';

function carehomeCopy(kind: StatusChangeKind, name: string) {
  if (kind === 'deactivated') {
    return {
      subject: `${name} has been deactivated on CarePaddy`,
      body: [
        `Hello,`,
        ``,
        `${name} has been deactivated on CarePaddy. Your staff can no longer sign in or place orders, and guardians have been told the care home is currently unavailable.`,
        `Your data has not been deleted.`,
        ``,
        `To discuss this or arrange reactivation, contact ${SUPPORT_CONTACT}.`,
        ``,
        `— CarePaddy`,
      ].join('\n'),
    };
  }
  return {
    subject: `${name} has been reactivated on CarePaddy`,
    body: [
      `Hello,`,
      ``,
      `${name} has been reactivated on CarePaddy. Your staff can sign in again (existing sessions were ended, so everyone needs to sign in afresh).`,
      ``,
      `— CarePaddy`,
    ].join('\n'),
  };
}

/** Deliberately neutral: never include the internal deactivation reason. */
function guardianCopy(kind: StatusChangeKind, name: string) {
  if (kind === 'deactivated') {
    return {
      subject: `${name} is currently unavailable on CarePaddy`,
      body: [
        `Hello,`,
        ``,
        `${name} is currently unavailable on CarePaddy. You will not be able to place new requests for this care home for now.`,
        ``,
        `Please contact the care home directly if you have questions.`,
        ``,
        `— CarePaddy`,
      ].join('\n'),
    };
  }
  return {
    subject: `${name} is available again on CarePaddy`,
    body: [`Hello,`, ``, `${name} is available again on CarePaddy.`, ``, `— CarePaddy`].join('\n'),
  };
}

async function deliverStatusChange(carehomeId: string, kind: StatusChangeKind) {
  const home = await prisma.carehome.findUnique({
    where: { id: carehomeId },
    select: { name: true, email: true },
  });
  if (!home) return;

  const homeCopy = carehomeCopy(kind, home.name);
  try {
    await emailSender.send({ to: home.email, ...homeCopy });
  } catch (err) {
    logger.warn({ err, carehomeId, kind }, 'carehome status email failed');
  }

  const links = await prisma.guardianResident.findMany({
    where: { tenantId: carehomeId, status: 'active' },
    distinct: ['guardianId'],
    select: { guardian: { select: { id: true, email: true } } },
  });

  const copy = guardianCopy(kind, home.name);
  let sent = 0;
  let failed = 0;
  let skippedNoEmail = 0;
  for (const { guardian } of links) {
    if (!guardian.email) {
      skippedNoEmail++;
      continue;
    }
    try {
      await emailSender.send({ to: guardian.email, ...copy });
      sent++;
    } catch (err) {
      failed++;
      logger.warn({ err, carehomeId, guardianId: guardian.id, kind }, 'guardian status email failed');
    }
    await sleep(BULK_SEND_INTERVAL_MS);
  }

  logger.info(
    { carehomeId, kind, guardians: links.length, sent, failed, skippedNoEmail },
    'carehome status notifications finished',
  );
}

/** Call only after the status change has committed. Failures never affect the status change. */
export function notifyCarehomeStatusChange(carehomeId: string, kind: StatusChangeKind): void {
  setImmediate(() => {
    deliverStatusChange(carehomeId, kind).catch((err) => {
      logger.error({ err, carehomeId, kind }, 'carehome status notifications crashed');
    });
  });
}

export function scheduleCarehomeCqcCheck(carehomeId: string): void {
  void (async () => {
    const home = await prisma.carehome.findUnique({
      where: { id: carehomeId },
      select: { cqcNumber: true, name: true, postcode: true },
    });
    if (!home) return;
    runCqcCheckInBackground(
      carehomeId,
      { cqcNumber: home.cqcNumber, name: home.name, postcode: home.postcode ?? '' },
      async (result) => {
        await prisma.carehome.update({
          where: { id: carehomeId },
          data: { cqcCheck: result.valid, cqcCheckedAt: new Date() },
        });
      },
    );
  })().catch((err) => logger.warn({ err, carehomeId }, 'scheduling CQC check failed'));
}
