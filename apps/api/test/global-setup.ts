import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Aplica as migrations reais (init + constraints) no banco de teste descartável. */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbDir = path.resolve(__dirname, '../../../packages/database');
  const cli = require.resolve('prisma/build/index.js', { paths: [dbDir] });
  execFileSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', path.join(dbDir, 'prisma/schema.prisma')], {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
