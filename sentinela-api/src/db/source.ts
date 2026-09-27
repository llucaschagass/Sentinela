import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { required, settings } from '../config';
import { InitialSchema1780000000000 } from './migration';
export function createSource(database = settings.database): DataSource {
  // Tedious accepts these options; normalize GUID casing across inserted and selected IDs.
  const options = { encrypt: true, trustServerCertificate: process.env.DB_TRUST_CERTIFICATE === 'true', useUTC: true,
    lowerCaseGuids: true, serverName: settings.host === '127.0.0.1' ? 'localhost' : undefined };
  return new DataSource({
    type: 'mssql', host: settings.host, port: settings.port, database,
    username: settings.user, password: required('DB_PASSWORD'),
    options,
    synchronize: false, logging: false, migrations: [InitialSchema1780000000000],
    connectionTimeout: 15000, requestTimeout: 15000, pool: { max: 10, min: 0 },
  });
}
