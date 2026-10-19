// Gera o Prisma Client dentro de um pacote implantado por `pnpm deploy` (api/worker).
// Executar com o diretório do pacote implantado como cwd: node /repo/infra/docker/prisma-generate.cjs
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dbDir = path.dirname(require.resolve('@adapterpay/database/package.json', { paths: [process.cwd()] }));
const cli = require.resolve('prisma/build/index.js', { paths: [dbDir] });
execFileSync(process.execPath, [cli, 'generate', '--schema', path.join(dbDir, 'prisma', 'schema.prisma')], { stdio: 'inherit' });
