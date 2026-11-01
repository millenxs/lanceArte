import { readFile } from 'node:fs/promises';
import { pool } from './db.js';

try {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  console.log('Schema do LanceArte aplicado.');
} finally {
  await pool.end();
}
