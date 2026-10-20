import { randomToken } from '@adapterpay/core';
import { createPrismaClient } from '@adapterpay/database';
import { hashPassword } from '../auth/password';

/**
 * Suporte Adapter Co: gera uma senha temporária para um usuário (útil sem SMTP configurado).
 * Uso: node dist/cli/reset-password.js email@cliente.com.br
 * A senha é exibida UMA vez, as sessões abertas são encerradas e o MFA do usuário é mantido.
 */
async function main(): Promise<void> {
  const [email] = process.argv.slice(2);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Uso: reset-password <email>');
    process.exit(2);
  }
  const prisma = createPrismaClient();
  try {
    const normalized = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalized } });
    if (!user) {
      console.error(`Usuário não encontrado: ${normalized}`);
      process.exit(1);
    }
    const password = `${randomToken(12)}9a`;
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null },
    });
    await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await prisma.auditLog.create({
      data: { actorType: 'SYSTEM', resourceType: 'user', resourceId: user.id, action: 'auth.password_reset_by_support' },
    });
    console.log(`Usuário: ${normalized}`);
    console.log(`Senha temporária (exibida uma única vez): ${password}`);
    console.log('Peça para trocar a senha depois de entrar.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
