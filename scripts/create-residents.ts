import { prisma } from '../src/lib/prisma.js';

async function main() {
  const tenantId = process.argv[2];
  const ts = process.argv[3];
  if (!tenantId || !ts) {
    throw new Error('Usage: create-residents.ts <tenantId> <ts>');
  }

  const r1 = await prisma.resident.create({
    data: { tenantId, name: 'Alice Resident', residentNumber: `R-${ts}-1` },
  });
  const r2 = await prisma.resident.create({
    data: { tenantId, name: 'Bob Resident', residentNumber: `R-${ts}-2` },
  });

  process.stdout.write(
    JSON.stringify({
      r1: r1.id,
      r2: r2.id,
      n2: r2.name,
      num2: r2.residentNumber,
    }),
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
