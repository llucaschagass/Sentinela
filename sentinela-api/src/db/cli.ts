import { randomUUID, createHash } from 'node:crypto';
import { createSource } from './source';
import { required, settings } from '../config';
async function main() {
  const action = process.argv[2];
  if (!['create','migrate','revert','seed'].includes(action)) throw new Error('Comando inválido');
  const source = createSource(action === 'create' ? 'master' : settings.database);
  await source.initialize();
  try {
    if (action === 'create') {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(settings.database)) throw new Error('DB_NAME inválido');
      if (!(await source.query('SELECT name FROM sys.databases WHERE name=@0', [settings.database])).length)
        await source.query(`CREATE DATABASE [${settings.database}]`);
    } else if (action === 'migrate') await source.runMigrations({ transaction: 'all' });
    else if (action === 'revert') await source.undoLastMigration({ transaction: 'all' });
    else {
      const key = required('SENTINELA_INGESTION_KEY');
      if (key.length < 32) throw new Error('Chave precisa de pelo menos 32 caracteres aleatórios');
      const hash = createHash('sha256').update(key).digest('hex');
      await source.query(`IF EXISTS (SELECT 1 FROM Applications WHERE slug=@0)
        UPDATE Applications SET keyHash=@1 WHERE slug=@0
        ELSE INSERT INTO Applications(id,name,slug,keyHash) VALUES(@2,@3,@0,@1)`,
        ['sentinela-test-api', hash, randomUUID(), 'API de demonstração']);
    }
    console.log(`Banco: ${action} concluído.`);
  } finally { await source.destroy(); }
}
main().catch(() => { console.error('Operação de banco falhou. Confira configuração, disponibilidade e migrations. Nenhuma credencial foi registrada.'); process.exitCode = 1; });
