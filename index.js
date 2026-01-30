const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Configuración de conexión vista en tu DBeaver
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres', // Nombre exacto de tu DB según image_69de55.png
    password: 'admin',    // Tu contraseña de Postgres
    port: 5432,
});

// RUTA DE LOGIN (Corregida)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM usuarios WHERE username = $1 AND password = $2',
            [username, password]
        );

        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0].username });
        } else {
            res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error en el servidor");
    }
});

// RUTA DE MESAS
app.get('/api/mesas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM mesas ORDER BY numero_mesa');
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.listen(3000, () => {
    console.log('🚀 Servidor corriendo en http://localhost:3000');
});
