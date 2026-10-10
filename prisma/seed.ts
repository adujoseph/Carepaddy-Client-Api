import dotenv from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { hashPassword } from '../src/lib/password.js';
import { ADMIN_PERMISSIONS, SUPER_ADMIN_ROLE_NAME } from '../src/modules/admin/permissions.js';

dotenv.config({ quiet: true });

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!email || !password) {
    console.log('Skipping admin seed — set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD');
    return;
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const nameLower = SUPER_ADMIN_ROLE_NAME.toLowerCase();
  let role = await prisma.adminRole.findUnique({ where: { nameLower } });

  if (!role) {
    role = await prisma.adminRole.create({
      data: {
        name: SUPER_ADMIN_ROLE_NAME,
        nameLower,
        description: 'Full platform access',
        isSystem: true,
        permissions: {
          create: ADMIN_PERMISSIONS.map((permissionKey) => ({ permissionKey })),
        },
      },
    });
    console.log('Created SUPER_ADMIN role');
  } else {
    const existing = await prisma.adminRolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionKey: true },
    });
    const have = new Set(existing.map((p) => p.permissionKey));
    const missing = ADMIN_PERMISSIONS.filter((k) => !have.has(k));
    if (missing.length > 0) {
      await prisma.adminRolePermission.createMany({
        data: missing.map((permissionKey) => ({ roleId: role!.id, permissionKey })),
      });
      console.log(`Added ${missing.length} permission(s) to SUPER_ADMIN role`);
    }
  }

  const existing = await prisma.adminUser.findUnique({ where: { emailLower: email } });
  if (existing) {
    console.log('Admin seed user already exists');
  } else {

    await prisma.adminUser.create({
      data: {
        email,
        emailLower: email,
        name: 'Super Admin',
        password: await hashPassword(password),
        status: 'ACTIVE',
        mustChangePassword: true,
        roleId: role.id,
      },
    });

    console.log(`Seeded super admin: ${email}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
