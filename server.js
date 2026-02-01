const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors'); 
const app = express(); 

// CONEXIÓN A BASE DE DATOS
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

// --- CAJA Y REPORTES ---
app.get('/api/caja/actual', async (req, res) => {
    try {
        const ultimoCierre = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres");
        const fechaInicio = ultimoCierre.rows[0].fecha;

        const result = await pool.query(`
            SELECT COALESCE(SUM(total_tiempo), 0) as total_tiempo, 
                   COALESCE(SUM(total_productos), 0) as total_productos, 
                   COALESCE(SUM(total_final), 0) as total_dia 
            FROM ventas 
            WHERE fecha > $1
        `, [fechaInicio]);
        
        const listaVentas = await pool.query(`
            SELECT mesa_id, tipo_mesa, total_final, total_tiempo, total_productos, TO_CHAR(fecha, 'HH24:MI') as hora
            FROM ventas
            WHERE fecha > $1
            ORDER BY fecha DESC
        `, [fechaInicio]);

        res.json({ ...result.rows[0], lista: listaVentas.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/caja/cerrar', async (req, res) => {
    try {
        const ultimoCierre = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres");
        const fechaInicio = ultimoCierre.rows[0].fecha;
        const totales = await pool.query(`SELECT COALESCE(SUM(total_final), 0) as total, COUNT(*) as cantidad FROM ventas WHERE fecha > $1`, [fechaInicio]);
        await pool.query('INSERT INTO cierres (total_ventas, cantidad_mesas, fecha_cierre) VALUES ($1, $2, NOW())', [totales.rows[0].total, totales.rows[0].cantidad]);
        res.json({ success: true, total: totales.rows[0].total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reportes/historial', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM cierres ORDER BY fecha_cierre DESC LIMIT 30');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/reportes/eliminar/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const target = await pool.query('SELECT fecha_cierre FROM cierres WHERE id = $1', [id]);
        if (target.rows.length === 0) return res.status(404).json({ error: 'Reporte no encontrado' });
        const fechaEsteReporte = target.rows[0].fecha_cierre;
        const prev = await pool.query('SELECT MAX(fecha_cierre) as fecha FROM cierres WHERE fecha_cierre < $1', [fechaEsteReporte]);
        const fechaReporteAnterior = prev.rows[0].fecha || '2000-01-01';
        await pool.query('DELETE FROM ventas WHERE fecha > $1 AND fecha <= $2', [fechaReporteAnterior, fechaEsteReporte]);
        await pool.query('DELETE FROM cierres WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- OPERACIONES ---
app.post('/api/productos/agregar-stock', async (req, res) => {
    try { await pool.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [req.body.cantidad, req.body.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/productos/restar-stock', async (req, res) => {
    try { await pool.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [req.body.cantidad, req.body.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/productos/nuevo', async (req, res) => {
    try { await pool.query('INSERT INTO productos (nombre, precio_venta, stock) VALUES ($1, $2, $3)', [req.body.nombre, req.body.precio, req.body.stock||0]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message})}
});
app.delete('/api/productos/eliminar/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM pedidos_mesa WHERE producto_id = $1', [id]);
        await pool.query('DELETE FROM productos WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Error al eliminar' }); }
});

app.post('/api/mesas/abrir/:id', async (req, res) => {
    try { await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NOW() WHERE id = $2', ['OCUPADA', req.params.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message})}
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
app.delete('/api/pedidos/eliminar/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pedido = await pool.query('SELECT producto_id, cantidad FROM pedidos_mesa WHERE id = $1', [id]);
        if (pedido.rows.length > 0) {
            const { producto_id, cantidad } = pedido.rows[0];
            await pool.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [cantidad, producto_id]);
            await pool.query('DELETE FROM pedidos_mesa WHERE id = $1', [id]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/mesas/cambiar', async (req, res) => {
    try {
        const { idOrigen, idDestino } = req.body;
        const origen = await pool.query('SELECT * FROM mesas WHERE id = $1', [idOrigen]);
        const destino = await pool.query('SELECT * FROM mesas WHERE id = $1', [idDestino]);
        
        if(origen.rows[0].estado !== 'OCUPADA') return res.status(400).json({error: 'Mesa origen no ocupada'});
        if(destino.rows[0].estado !== 'LIBRE') return res.status(400).json({error: 'Mesa destino ocupada'});

        const horaInicio = origen.rows[0].hora_inicio;
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = $2 WHERE id = $3', ['OCUPADA', horaInicio, idDestino]);
        await pool.query('UPDATE pedidos_mesa SET mesa_id = $1 WHERE mesa_id = $2', [idDestino, idOrigen]);
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NULL WHERE id = $2', ['LIBRE', idOrigen]);

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// [MODIFICADO] RUTA DETALLE CON TOLERANCIA
app.get('/api/mesas/detalle/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        
        let totalT = 0;
        let minReal = 0;
        
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - $1))/60 AS min", [mesa.hora_inicio]);
            minReal = Math.ceil(resT.rows[0].min || 0); // Minutos reales (ej. 34)
            
            // LÓGICA DE TOLERANCIA 5 MINUTOS:
            // Restamos 5 min al tiempo real para el cálculo de bloques.
            // Ejemplo: Si lleva 34 min -> 34 - 5 = 29.
            // 29 / 30 = 0.96 -> Math.ceil = 1 bloque.
            // 1 bloque * 30 min * (10 soles / 60 min) = 5 soles.
            
            let tiempoCalculo = minReal - 5;
            
            // Aseguramos que cobre al menos el mínimo (30 min) si estuvo poco tiempo
            let bloques = Math.ceil(tiempoCalculo / 30);
            if (bloques < 1) bloques = 1; 

            const minCobrar = bloques * 30; 
            totalT = (minCobrar / 60) * 10.00;
        }

        const resProds = await pool.query(`SELECT pm.id, pm.producto_id, p.nombre, pm.cantidad, p.precio_venta FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id WHERE pm.mesa_id = $1 AND pm.pagado = FALSE ORDER BY pm.id ASC`, [id]);
        let totalC = 0;
        const listaProductos = resProds.rows.map(p => { totalC += p.precio_venta * p.cantidad; return { ...p, subtotal: p.precio_venta * p.cantidad }; });
        
        // Enviamos 'minReal' para que en pantalla se vea el tiempo real (ej: "34 min"), 
        // pero 'totalTiempo' ya tiene el descuento aplicado.
        res.json({ tipo: mesa.tipo, minutos: minReal, totalTiempo: totalT, listaProductos: listaProductos, totalProductos: totalC, totalFinal: totalT + totalC });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// [MODIFICADO] RUTA CERRAR CON TOLERANCIA
app.post('/api/mesas/cerrar/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        let totalT = 0;
        
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - $1))/60 AS min", [mesa.hora_inicio]);
            const minReal = Math.ceil(resT.rows[0].min || 0);
            
            // APLICAMOS LA MISMA TOLERANCIA AL CERRAR
            let tiempoCalculo = minReal - 5;
            let bloques = Math.ceil(tiempoCalculo / 30);
            if (bloques < 1) bloques = 1;

            const minCobrar = bloques * 30;
            totalT = (minCobrar / 60) * 10.00;
        }

        const resC = await pool.query(`SELECT SUM(p.precio_venta * pm.cantidad) as total FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id WHERE pm.mesa_id = $1 AND pm.pagado = FALSE`, [id]);
        const totalC = parseFloat(resC.rows[0].total || 0);
        const totalF = totalT + totalC;
        
        await pool.query('INSERT INTO ventas (mesa_id, tipo_mesa, total_tiempo, total_productos, total_final) VALUES ($1, $2, $3, $4, $5)', [id, mesa.tipo, totalT, totalC, totalF]);
        await pool.query('UPDATE pedidos_mesa SET pagado = TRUE WHERE mesa_id = $1', [id]);
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NULL WHERE id = $2', ['LIBRE', id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎱 Servidor funcionando en puerto ${PORT}`));