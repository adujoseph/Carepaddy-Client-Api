import { prisma } from '../src/lib/prisma.js';
import { signInviteToken } from '../src/lib/jwt.js';

async function main() {
  const inviteId = process.argv[2];
  if (!inviteId) throw new Error('Usage: sign-invite.ts <inviteId>');

  const invite = await prisma.invite.findUniqueOrThrow({ where: { id: inviteId } });
  const token = await signInviteToken({
    jti: invite.jti,
    tenantId: invite.tenantId,
    residentId: invite.residentId,
    guardianName: invite.guardianName,
    email: invite.email,
    phone: invite.phone,
  });
  process.stdout.write(token);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
