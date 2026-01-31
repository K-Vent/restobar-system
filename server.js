const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors'); 
const app = express();

// CONFIGURACIÓN DE BASE DE DATOS
const pool = new Pool({
    connectionString: 'postgresql://postgres.iqrhtvwddlqlrenfsaxa:Laesquinadelbillar@aws-1-sa-east-1.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false } 
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- RUTAS DE LOGIN ---
app.post(['/login', '/api/login'], async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM usuarios WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) res.json({ success: true });
        else res.status(401).json({ success: false });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- API MESAS Y PRODUCTOS ---
app.get('/api/mesas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM mesas ORDER BY numero_mesa ASC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/productos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM productos ORDER BY nombre ASC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- NUEVA LÓGICA DE CAJA (CORTE MANUAL) ---

// 1. Ver el acumulado ACTUAL (Desde el último cierre hasta ahora)
app.get('/api/caja/actual', async (req, res) => {
    try {
        // Buscamos la fecha del último cierre. Si no hay, usamos una fecha muy antigua.
        const ultimoCierre = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres");
        const fechaInicio = ultimoCierre.rows[0].fecha;

        const result = await pool.query(`
            SELECT COALESCE(SUM(total_tiempo), 0) as total_tiempo, 
                   COALESCE(SUM(total_productos), 0) as total_productos, 
                   COALESCE(SUM(total_final), 0) as total_dia, 
                   COUNT(*) as cantidad_mesas
            FROM ventas 
            WHERE fecha > $1
        `, [fechaInicio]);
        
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. CERRAR CAJA (Guardar y resetear)
app.post('/api/caja/cerrar', async (req, res) => {
    try {
        // Calculamos totales actuales
        const ultimoCierre = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres");
        const fechaInicio = ultimoCierre.rows[0].fecha;

        const totales = await pool.query(`
            SELECT COALESCE(SUM(total_final), 0) as total, COUNT(*) as cantidad
            FROM ventas WHERE fecha > $1
        `, [fechaInicio]);

        const totalVenta = totales.rows[0].total;
        const totalMesas = totales.rows[0].cantidad;

        // Guardamos el cierre en la historia
        await pool.query('INSERT INTO cierres (total_ventas, cantidad_mesas, fecha_cierre) VALUES ($1, $2, NOW())', [totalVenta, totalMesas]);

        res.json({ success: true, total: totalVenta });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. Ver Historial de Cierres (Para la página de Reportes)
app.get('/api/reportes/historial', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM cierres ORDER BY fecha_cierre DESC LIMIT 30');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- GESTIÓN DE INVENTARIO ---
app.post('/api/productos/agregar-stock', async (req, res) => {
    try {
        const { id, cantidad } = req.body;
        await pool.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [cantidad, id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/productos/restar-stock', async (req, res) => {
    try {
        const { id, cantidad } = req.body;
        await pool.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [cantidad, id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/productos/nuevo', async (req, res) => {
    try {
        const { nombre, precio, stock } = req.body;
        await pool.query('INSERT INTO productos (nombre, precio_venta, stock) VALUES ($1, $2, $3)', [nombre, precio, stock || 0]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/productos/eliminar/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM productos WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: 'No se puede eliminar: Tiene ventas asociadas.' }); }
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

app.post('/api/mesas/cerrar/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        let totalT = 0, minReal = 0, minCobrar = 0;

        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - $1))/60 AS min", [mesa.hora_inicio]);
            minReal = Math.ceil(resT.rows[0].min || 0);
            minCobrar = minReal <= 30 ? 30 : Math.ceil(minReal / 30) * 30;
            totalT = (minCobrar / 60) * 10.00;
        }

        const resC = await pool.query(`SELECT SUM(p.precio_venta * pm.cantidad) as total FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id WHERE pm.mesa_id = $1 AND pm.pagado = FALSE`, [id]);
        const totalC = parseFloat(resC.rows[0].total || 0);
        const totalF = totalT + totalC;

        await pool.query('INSERT INTO ventas (mesa_id, tipo_mesa, total_tiempo, total_productos, total_final) VALUES ($1, $2, $3, $4, $5)', [id, mesa.tipo, totalT, totalC, totalF]);
        await pool.query('UPDATE pedidos_mesa SET pagado = TRUE WHERE mesa_id = $1', [id]);
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NULL WHERE id = $2', ['LIBRE', id]);

        res.json({ tipo: mesa.tipo, minReal, minCobrar, totalT: totalT.toFixed(2), totalC: totalC.toFixed(2), totalF: totalF.toFixed(2) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎱 Servidor funcionando en puerto ${PORT}`));