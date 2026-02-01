const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors'); 
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session); // [NUEVO]
const app = express(); 

// CONEXIÓN A BASE DE DATOS
const pool = new Pool({
    connectionString: 'postgresql://postgres.iqrhtvwddlqlrenfsaxa:Laesquinadelbillar@aws-1-sa-east-1.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false } 
});

// [IMPORTANTE] Configuración para Render/Nube
app.set('trust proxy', 1); 

// CONFIGURACIÓN DE SEGURIDAD (SESIONES EN BASE DE DATOS)
app.use(session({
    store: new pgSession({
        pool : pool,                // Usamos la misma conexión
        tableName : 'session',      // Nombre de la tabla
        createTableIfMissing: true  // [MAGIA] La crea si no existe
    }),
    secret: 'secreto_super_seguro_billar_123',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: true,               // True porque estás en HTTPS (Render)
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días de duración
        sameSite: 'none'            // Ayuda con problemas de cookies en Chrome
    }
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// MIDDLEWARE: EL PORTERO
const verificarSesion = (req, res, next) => {
    if (req.session.usuario) {
        next();
    } else {
        // Si intenta acceder a una API y no tiene sesión, enviamos error 401 (no HTML)
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
        }
        res.redirect('/'); 
    }
};

// --- RUTAS DE ARCHIVOS (PROTEGIDAS) ---
// Asegúrate de que estos archivos estén en la carpeta 'private'
app.get('/dashboard.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'dashboard.html')));
app.get('/inventario.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'inventario.html')));
app.get('/reportes.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'reportes.html')));
app.get('/cierre_caja.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'cierre_caja.html')));

// --- LOGIN Y LOGOUT ---
app.post(['/login', '/api/login'], async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM usuarios WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) {
            req.session.usuario = result.rows[0]; 
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// --- API ---

// [AUTO-MIGRACIÓN CATEGORÍAS]
(async () => {
    try { await pool.query("ALTER TABLE productos ADD COLUMN categoria VARCHAR(50) DEFAULT 'General'"); } catch (e) {}
})();

// Rutas API (Protegidas opcionalmente, aquí las dejo abiertas para evitar problemas de CORS por ahora, pero lo ideal es protegerlas)
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

app.get('/api/caja/actual', async (req, res) => {
    try {
        const ultimoCierre = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres");
        const fechaInicio = ultimoCierre.rows[0].fecha;
        const result = await pool.query(`SELECT COALESCE(SUM(total_tiempo), 0) as total_tiempo, COALESCE(SUM(total_productos), 0) as total_productos, COALESCE(SUM(total_final), 0) as total_dia FROM ventas WHERE fecha > $1`, [fechaInicio]);
        const listaVentas = await pool.query(`SELECT mesa_id, tipo_mesa, total_final, total_tiempo, total_productos, TO_CHAR(fecha, 'HH24:MI') as hora FROM ventas WHERE fecha > $1 ORDER BY fecha DESC`, [fechaInicio]);
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
    try { const result = await pool.query('SELECT * FROM cierres ORDER BY fecha_cierre DESC LIMIT 30'); res.json(result.rows); } catch (e) { res.status(500).json({ error: e.message }); }
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

app.post('/api/productos/nuevo', async (req, res) => {
    try { 
        const { nombre, precio, stock, categoria } = req.body;
        const cat = categoria || 'General';
        await pool.query('INSERT INTO productos (nombre, precio_venta, stock, categoria) VALUES ($1, $2, $3, $4)', [nombre, precio, stock||0, cat]); 
        res.json({success:true}); 
    } catch(e){res.status(500).json({error:e.message})}
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

app.get('/api/mesas/detalle/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        let totalT = 0, minReal = 0;
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - $1))/60 AS min", [mesa.hora_inicio]);
            minReal = Math.ceil(resT.rows[0].min || 0);
            let tiempoCalculo = minReal - 5;
            let bloques = Math.ceil(tiempoCalculo / 30);
            if (bloques < 1) bloques = 1; 
            const minCobrar = bloques * 30; 
            totalT = (minCobrar / 60) * 10.00;
        }
        const resProds = await pool.query(`SELECT pm.id, pm.producto_id, p.nombre, pm.cantidad, p.precio_venta FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id WHERE pm.mesa_id = $1 AND pm.pagado = FALSE ORDER BY pm.id ASC`, [id]);
        let totalC = 0;
        const listaProductos = resProds.rows.map(p => { totalC += p.precio_venta * p.cantidad; return { ...p, subtotal: p.precio_venta * p.cantidad }; });
        res.json({ tipo: mesa.tipo, minutos: minReal, totalTiempo: totalT, listaProductos: listaProductos, totalProductos: totalC, totalFinal: totalT + totalC });
    } catch (e) { 
        console.error("Error en detalle:", e);
        res.status(500).json({ error: e.message }); 
    }
});

// [ESTA ERA LA RUTA QUE FALTABA]
app.post('/api/mesas/abrir/:id', async (req, res) => {
    try { 
        // Cambiamos estado a OCUPADA y guardamos la hora exacta de inicio
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NOW() WHERE id = $2', ['OCUPADA', req.params.id]); 
        res.json({success:true}); 
    } catch(e){
        res.status(500).json({error:e.message})
    }
});

// [TAMBIÉN FALTABA ESTA PARA CAMBIAR MESA]
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

app.post('/api/mesas/cerrar/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        let totalT = 0;
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - $1))/60 AS min", [mesa.hora_inicio]);
            const minReal = Math.ceil(resT.rows[0].min || 0);
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

// Agrega aquí las rutas que falten como stock, mover mesa, etc. copiando del anterior si falta algo.

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎱 Servidor funcionando en puerto ${PORT}`));