import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function getUsers() {
  const result = await pool.query('SELECT * FROM users');
  return result.rows;
}

export async function getUserById(id: string) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}
