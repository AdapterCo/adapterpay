import { hash, verify } from '@node-rs/argon2';

/** Argon2id (padrão do @node-rs/argon2) com parâmetros recomendados pela OWASP (19 MiB, t=2, p=1). */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (!passwordHash) {
    // Equaliza o tempo de resposta quando o usuário não existe/sem senha (evita enumeração por tempo).
    await hash(password, OPTIONS).catch(() => undefined);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
