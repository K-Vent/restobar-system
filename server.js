const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors'); 
const app = express();

// CONFIGURACIÓN DE BASE DE DATOS
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Laesquinadelbillar@db.iqrhtvwddlqlrenfsaxa.supabase.co:5432/postgres',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- RUTAS DE LOGIN Y DATOS ---

app.post(['/login', '/api/login'], async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM usuarios WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) res.json({ success: true });
        else res.status(401).json({ success: false });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mesas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM mesas ORDER BY numero_mesa ASC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/productos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM productos WHERE stock > 0 ORDER BY nombre ASC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reporte/hoy', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT COALESCE(SUM(total_tiempo), 0) as total_tiempo, COALESCE(SUM(total_productos), 0) as total_productos, COALESCE(SUM(total_final), 0) as total_dia, COUNT(*) as cantidad_mesas
            FROM ventas WHERE DATE(fecha) = CURRENT_DATE
        `);
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- OPERACIONES DE MESAS ---

app.post('/api/mesas/abrir/:id', async (req, res) => {
    try {
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NOW() WHERE id = $2', ['OCUPADA', req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pedidos/agregar', async (req, res) => {
    try {
        const { mesa_id, producto_id, cantidad } = req.body;
        const cant = parseInt(cantidad) || 1; 
        await pool.query('INSERT INTO pedidos_mesa (mesa_id, producto_id, cantidad) VALUES ($1, $2, $3)', [mesa_id, producto_id, cant]);
        await pool.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [cant, producto_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- AQUÍ ESTÁ LA CORRECCIÓN DEL TIEMPO ---
app.post('/api/mesas/cerrar/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        
        // 1. Declaramos las variables AFUERA del if para que no se pierdan
        let totalT = 0;
        let minReal = 0;
        let minCobrar = 0;

        // 2. Calculamos tiempo solo si es BILLAR
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - $1))/60 AS min", [mesa.hora_inicio]);
            minReal = Math.ceil(resT.rows[0].min || 0);
            minCobrar = minReal <= 30 ? 30 : Math.ceil(minReal / 30) * 30;
            totalT = (minCobrar / 60) * 10.00;
        }

        // 3. Calculamos productos
        const resC = await pool.query(`
            SELECT SUM(p.precio_venta * pm.cantidad) as total 
            FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id 
            WHERE pm.mesa_id = $1 AND pm.pagado = FALSE
        `, [id]);
        
        const totalC = parseFloat(resC.rows[0].total || 0);
        const totalF = totalT + totalC;

        // 4. Guardamos venta y limpiamos
        await pool.query('INSERT INTO ventas (mesa_id, tipo_mesa, total_tiempo, total_productos, total_final) VALUES ($1, $2, $3, $4, $5)', [id, mesa.tipo, totalT, totalC, totalF]);
        await pool.query('UPDATE pedidos_mesa SET pagado = TRUE WHERE mesa_id = $1', [id]);
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NULL WHERE id = $2', ['LIBRE', id]);

        // 5. Enviamos las variables reales
        res.json({ 
            tipo: mesa.tipo, 
            minReal: minReal,     // Ahora sí envía el valor real
            minCobrar: minCobrar, // Ahora sí envía el valor real
            totalT: totalT.toFixed(2), 
            totalC: totalC.toFixed(2), 
            totalF: totalF.toFixed(2) 
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎱 Servidor funcionando en puerto ${PORT}`));
