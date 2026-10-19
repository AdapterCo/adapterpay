import { randomToken } from '@adapterpay/core';
import { createPrismaClient } from '@adapterpay/database';
import { hashPassword } from '../auth/password';

/**
 * Cria (ou promove) um usuário SUPERADMIN da equipe Adapter Co.
 * Uso: node dist/cli/create-superadmin.js email@adapterco.com.br "Nome Completo"
 * A senha temporária é exibida UMA vez; no primeiro login a ativação de MFA é obrigatória.
 */
async function main(): Promise<void> {
  const [email, name] = process.argv.slice(2);
  if (!email || !name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Uso: create-superadmin <email> "<nome>"');
    process.exit(2);
  }
  const prisma = createPrismaClient();
  try {
    const password = `${randomToken(12)}9a`;
    const passwordHash = await hashPassword(password);
    const normalized = email.trim().toLowerCase();
    const user = await prisma.user.upsert({
      where: { email: normalized },
      create: { email: normalized, name, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(), isSuperadmin: true },
      update: { isSuperadmin: true, passwordHash, status: 'ACTIVE', mfaEnabledAt: null, mfaSecretEnc: null, mfaRecoveryHashes: [] },
    });
    await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await prisma.auditLog.create({
      data: { actorType: 'SYSTEM', resourceType: 'user', resourceId: user.id, action: 'superadmin.provisioned' },
    });
    console.log(`Superadmin: ${normalized}`);
    console.log(`Senha temporária (exibida uma única vez): ${password}`);
    console.log('No primeiro login será exigida a ativação de MFA.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
