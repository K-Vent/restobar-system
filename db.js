const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'postgres',
  password: 'Shadow2022', // Reemplaza esto con la clave que pusiste en PostgreSQL
  port: 5432,
});

module.exports = pool;