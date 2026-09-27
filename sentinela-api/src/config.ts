import { config } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const root = existsSync(resolve(process.cwd(), '.env.example')) ? process.cwd() : resolve(process.cwd(), '..');
config({ path: resolve(root, '.env'), quiet: true });
export function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith('CHANGE_ME')) throw new Error(`Configure ${name} no .env`);
  return value;
}
export const settings = {
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || 'Sentinela', user: process.env.DB_USER || 'sa',
};
