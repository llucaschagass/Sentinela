const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
if (fs.existsSync('.env')) { console.error('.env já existe; preservado.'); process.exit(1); }
const password = 'Sn!' + randomBytes(24).toString('hex');
const content = fs.readFileSync('.env.example', 'utf8').replaceAll('CHANGE_ME_Strong_Password_123!', password).replace('CHANGE_ME_GENERATE_32_RANDOM_BYTES', randomBytes(32).toString('hex'));
fs.writeFileSync('.env', content, { mode: 0o600 });
console.log('.env criado com credenciais aleatórias; valores não exibidos.');
