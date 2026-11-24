// Creates (or resets) one demo account per role so the app can be tried without filling any forms.
// Idempotent: running it again only resets these accounts' name, role, affiliation and password.
// DEVELOPMENT ONLY: it refuses to run in production because the passwords below are public.
//
//   npm run db:seed-demo
//
// The same list lives in frontend/src/lib/demoAccounts.ts (the quick-access buttons on the login page).
import 'dotenv/config';
import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo accounts with NODE_ENV=production.');
  process.exit(1);
}

const prisma = new PrismaClient();

interface Demo {
  email: string;
  password: string;
  fullName: string;
  role: Role;
  affiliation: string;
}

const DEMO: Demo[] = [
  { email: 'admin@demo.edu', password: 'AdminDemo12345', fullName: 'Ana Administradora', role: 'ADMINISTRATOR', affiliation: 'UNIPOLI' },
  { email: 'rosa@demo.edu', password: 'UsuarioDemo123', fullName: 'Rosa Ávila (usuario)', role: 'USER', affiliation: 'UNIPOLI Durango' },
  { email: 'colaborador@demo.edu', password: 'ColabDemo12345', fullName: 'David Martínez (usuario)', role: 'USER', affiliation: 'UNIPOLI Durango' },
  { email: 'juez@demo.edu', password: 'JuezDemo12345', fullName: 'Christian Revisor (proyecto)', role: 'JUDGE', affiliation: 'Otra Universidad' },
  { email: 'inv@demo.edu', password: 'Inversor12345', fullName: 'José Luis Revisor (avances)', role: 'INVESTOR', affiliation: 'Empresa Demo' },
];

async function main() {
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const ownerExists = (await prisma.user.count({ where: { isOwner: true } })) > 0;

  for (const d of DEMO) {
    const passwordHash = await bcrypt.hash(d.password, rounds);
    const existing = await prisma.user.findUnique({ where: { email: d.email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          fullName: d.fullName,
          // The owner keeps its role; everyone else is reset to the demo role.
          ...(existing.isOwner ? {} : { role: d.role }),
          affiliation: d.affiliation,
          isActive: true,
          failedLoginCount: 0,
          firstFailedLoginAt: null,
          lockedUntil: null,
        },
      });
      console.log(`reset    ${d.role.padEnd(13)} ${d.email}`);
    } else {
      await prisma.user.create({
        data: {
          email: d.email,
          passwordHash,
          fullName: d.fullName,
          role: d.role,
          affiliation: d.affiliation,
          // The first administrator becomes the platform owner, like POST /auth/bootstrap-owner would.
          isOwner: d.role === 'ADMINISTRATOR' && !ownerExists,
        },
      });
      console.log(`created  ${d.role.padEnd(13)} ${d.email}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
