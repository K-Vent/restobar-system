require('dotenv').config(); // Carga las variables secretas del .env
const { Pool } = require('pg');

// Creamos el Pool usando la URL secreta
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,                      // Máximo 20 conexiones simultáneas
    idleTimeoutMillis: 30000,     // Cierra conexiones inactivas
    connectionTimeoutMillis: 2000 // Timeout rápido
});

// Forzar Hora Perú (UTC-5)
pool.on('connect', (client) => {
    client.query("SET TIME ZONE 'America/Lima'");
});

// Exportamos el pool para que el resto del sistema lo use
module.exports = pool;