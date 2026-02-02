const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors'); 
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet'); 
const rateLimit = require('express-rate-limit'); 
const app = express(); 

// CONEXIÓN DB
const pool = new Pool({
    connectionString: 'postgresql://postgres.iqrhtvwddlqlrenfsaxa:Laesquinadelbillar@aws-1-sa-east-1.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false } 
});

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: { error: "⛔ Demasiados intentos." } });

app.use(session({
    store: new pgSession({ pool : pool, tableName : 'session', createTableIfMissing: true }),
    secret: 'secreto_super_seguro_billar_123',
    resave: false, saveUninitialized: false,
    cookie: { secure: true, maxAge: 30*24*60*60*1000, sameSite: 'none' }
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- SEGURIDAD ---
const verificarSesion = (req, res, next) => {
    if (req.session.usuario) { next(); } 
    else {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autorizado.' });
        res.redirect('/'); 
    }
};

const soloAdmin = (req, res, next) => {
    if (req.session.usuario && req.session.usuario.rol === 'admin') { next(); } 
    else { res.status(403).json({ error: '⛔ Acceso Denegado.' }); }
};

// --- RUTAS HTML ---
app.get('/dashboard.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'dashboard.html')));
app.get('/inventario.html', verificarSesion, (req, res) => {
    if(req.session.usuario.rol !== 'admin') return res.redirect('/dashboard.html');
    res.sendFile(path.join(__dirname, 'private', 'inventario.html'));
});
app.get('/reportes.html', verificarSesion, (req, res) => {
    if(req.session.usuario.rol !== 'admin') return res.redirect('/dashboard.html');
    res.sendFile(path.join(__dirname, 'private', 'reportes.html'));
});
app.get('/cierre_caja.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'cierre_caja.html')));

// --- LOGIN ---
app.post(['/login', '/api/login'], loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM usuarios WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) {
            req.session.usuario = result.rows[0]; 
            res.json({ success: true, rol: result.rows[0].rol });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });
app.get('/api/usuario/actual', verificarSesion, (req, res) => {
    res.json({ username: req.session.usuario.username, rol: req.session.usuario.rol || 'mozo' });
});

// --- API NEGOCIO ---

// [AUTO-MIGRACIÓN: GASTOS] 🔧
(async () => {
    try { 
        // 1. Tabla de Gastos
        await pool.query("CREATE TABLE IF NOT EXISTS gastos (id SERIAL PRIMARY KEY, descripcion TEXT, monto DECIMAL(10,2), fecha TIMESTAMP DEFAULT NOW())");
        console.log("✅ Tabla 'gastos' verificada.");

        // 2. Columna total_gastos en Cierres (si no existe)
        await pool.query("ALTER TABLE cierres ADD COLUMN total_gastos DECIMAL(10,2) DEFAULT 0");
    } catch (e) { /* Ignoramos error si ya existe */ }
})();

// [NUEVO] Registrar Gasto
app.post('/api/gastos/nuevo', verificarSesion, async (req, res) => {
    try {
        const { descripcion, monto } = req.body;
        await pool.query('INSERT INTO gastos (descripcion, monto) VALUES ($1, $2)', [descripcion, monto]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// [MODIFICADO] Caja Actual (Ahora resta gastos)
app.get('/api/caja/actual', verificarSesion, async (req, res) => {
    try {
        const ultimoCierre = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres");
        const fechaInicio = ultimoCierre.rows[0].fecha;

        // 1. Sumar Ventas
        const ventas = await pool.query(`SELECT COALESCE(SUM(total_final), 0) as total FROM ventas WHERE fecha > $1`, [fechaInicio]);
        const totalVentas = parseFloat(ventas.rows[0].total);

        // 2. Sumar Gastos
        const gastos = await pool.query(`SELECT COALESCE(SUM(monto), 0) as total FROM gastos WHERE fecha > $1`, [fechaInicio]);
        const totalGastos = parseFloat(gastos.rows[0].total);

        // 3. Totales Desglosados
        const prod = await pool.query(`SELECT COALESCE(SUM(total_productos), 0) as total FROM ventas WHERE fecha > $1`, [fechaInicio]);
        const mesas = await pool.query(`SELECT COALESCE(SUM(total_tiempo), 0) as total FROM ventas WHERE fecha > $1`, [fechaInicio]);

        res.json({
            total_ventas: totalVentas,
            total_gastos: totalGastos,
            total_caja_real: totalVentas - totalGastos, // Esto es lo que debe haber en el cajón
            total_productos: parseFloat(prod.rows[0].total),
            total_mesas: parseFloat(mesas.rows[0].total)
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// [MODIFICADO] Cerrar Caja (Guarda ventas Y gastos)
app.post('/api/caja/cerrar', verificarSesion, async (req, res) => {
    try {
        const ultimoCierre = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres");
        const fechaInicio = ultimoCierre.rows[0].fecha;

        // Calculamos totales finales
        const resVentas = await pool.query(`SELECT COALESCE(SUM(total_final), 0) as total, COUNT(*) as cantidad FROM ventas WHERE fecha > $1`, [fechaInicio]);
        const resGastos = await pool.query(`SELECT COALESCE(SUM(monto), 0) as total FROM gastos WHERE fecha > $1`, [fechaInicio]);

        const totalVentas = parseFloat(resVentas.rows[0].total);
        const totalGastos = parseFloat(resGastos.rows[0].total);
        const cantidadMesas = parseInt(resVentas.rows[0].cantidad);

        // Guardamos el reporte
        await pool.query(
            'INSERT INTO cierres (total_ventas, total_gastos, cantidad_mesas, fecha_cierre) VALUES ($1, $2, $3, NOW())', 
            [totalVentas, totalGastos, cantidadMesas]
        );
        
        res.json({ success: true, total: totalVentas, gastos: totalGastos });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ... (RESTO DE RUTAS: mesas, productos, historial - MANTENER IGUAL QUE ANTES) ...
// Copia aquí las rutas de /api/mesas, /api/productos, etc. que ya tenías.
// IMPORTANTE: Recuerda pegar las rutas que faltan aquí abajo (verificarSesion, etc)

// --- RUTAS PÚBLICAS (Para Mozos y Admins) ---
app.get('/api/mesas', verificarSesion, async (req, res) => {
    try { const result = await pool.query('SELECT * FROM mesas ORDER BY numero_mesa ASC'); res.json(result.rows); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/productos', verificarSesion, async (req, res) => {
    try { const result = await pool.query('SELECT * FROM productos ORDER BY nombre ASC'); res.json(result.rows); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/mesas/abrir/:id', verificarSesion, async (req, res) => {
    try { await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NOW() WHERE id = $2', ['OCUPADA', req.params.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/pedidos/agregar', verificarSesion, async (req, res) => {
    try {
        const { mesa_id, producto_id, cantidad } = req.body;
        const cant = parseInt(cantidad) || 1; 
        await pool.query('INSERT INTO pedidos_mesa (mesa_id, producto_id, cantidad) VALUES ($1, $2, $3)', [mesa_id, producto_id, cant]);
        await pool.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [cant, producto_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/mesas/detalle/:id', verificarSesion, async (req, res) => {
    try {
        const { id } = req.params;
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        let totalT = 0, minReal = 0;
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - $1))/60 AS min", [mesa.hora_inicio]);
            minReal = Math.ceil(resT.rows[0].min || 0);
            let tiempoCalculo = minReal - 5; let bloques = Math.ceil(tiempoCalculo / 30); if (bloques < 1) bloques = 1; 
            const minCobrar = bloques * 30; totalT = (minCobrar / 60) * 10.00;
        }
        const resProds = await pool.query(`SELECT pm.id, pm.producto_id, p.nombre, pm.cantidad, p.precio_venta FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id WHERE pm.mesa_id = $1 AND pm.pagado = FALSE ORDER BY pm.id ASC`, [id]);
        let totalC = 0;
        const listaProductos = resProds.rows.map(p => { totalC += p.precio_venta * p.cantidad; return { ...p, subtotal: p.precio_venta * p.cantidad }; });
        res.json({ tipo: mesa.tipo, minutos: minReal, totalTiempo: totalT, listaProductos: listaProductos, totalProductos: totalC, totalFinal: totalT + totalC });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/mesas/cerrar/:id', verificarSesion, async (req, res) => {
    const { id } = req.params;
    try {
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        let totalT = 0;
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - $1))/60 AS min", [mesa.hora_inicio]);
            const minReal = Math.ceil(resT.rows[0].min || 0);
            let tiempoCalculo = minReal - 5; let bloques = Math.ceil(tiempoCalculo / 30); if (bloques < 1) bloques = 1;
            const minCobrar = bloques * 30; totalT = (minCobrar / 60) * 10.00;
        }
        const resC = await pool.query(`SELECT SUM(p.precio_venta * pm.cantidad) as total FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id WHERE pm.mesa_id = $1 AND pm.pagado = FALSE`, [id]);
        const totalC = parseFloat(resC.rows[0].total || 0); const totalF = totalT + totalC;
        await pool.query('INSERT INTO ventas (mesa_id, tipo_mesa, total_tiempo, total_productos, total_final) VALUES ($1, $2, $3, $4, $5)', [id, mesa.tipo, totalT, totalC, totalF]);
        await pool.query('UPDATE pedidos_mesa SET pagado = TRUE WHERE mesa_id = $1', [id]);
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NULL WHERE id = $2', ['LIBRE', id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/mesas/cambiar', verificarSesion, async (req, res) => {
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
// --- RUTAS SOLO ADMIN ---
app.post('/api/productos/nuevo', verificarSesion, soloAdmin, async (req, res) => {
    try { 
        const { nombre, precio, stock, categoria } = req.body;
        const cat = categoria || 'General';
        await pool.query('INSERT INTO productos (nombre, precio_venta, stock, categoria) VALUES ($1, $2, $3, $4)', [nombre, precio, stock||0, cat]); 
        res.json({success:true}); 
    } catch(e){res.status(500).json({error:e.message})}
});
app.delete('/api/productos/eliminar/:id', verificarSesion, soloAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM pedidos_mesa WHERE producto_id = $1', [id]);
        await pool.query('DELETE FROM productos WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Error al eliminar' }); }
});
app.post('/api/productos/agregar-stock', verificarSesion, soloAdmin, async (req, res) => {
    try { await pool.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [req.body.cantidad, req.body.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/productos/restar-stock', verificarSesion, soloAdmin, async (req, res) => {
    try { await pool.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [req.body.cantidad, req.body.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message})}
});
app.delete('/api/reportes/eliminar/:id', verificarSesion, soloAdmin, async (req, res) => {
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
app.get('/api/reportes/historial', verificarSesion, soloAdmin, async (req, res) => {
    try { const result = await pool.query('SELECT * FROM cierres ORDER BY fecha_cierre DESC LIMIT 30'); res.json(result.rows); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/pedidos/eliminar/:id', verificarSesion, async (req, res) => {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎱 Servidor funcionando en puerto ${PORT}`));