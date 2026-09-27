// Keep Angular's worker pool small on machines also running SQL Server/Docker.
const { spawn } = require('node:child_process');
const path = require('node:path');
const cli = path.join(path.dirname(require.resolve('@angular/cli/package.json')), 'bin/ng.js');
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, NG_BUILD_MAX_WORKERS: process.env.NG_BUILD_MAX_WORKERS || '2' }
});
child.on('exit', code => process.exit(code ?? 1));
child.on('error', () => process.exit(1));
