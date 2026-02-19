const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors'); 
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet'); 
const rateLimit = require('express-rate-limit'); 
const compression = require('compression'); // [NUEVO] Compresión de red

const app = express(); 

// ==========================================
// 1. CONFIGURACIÓN Y POOL DE CONEXIONES (OPTIMIZADO)
// ==========================================

const pool = new Pool({
    connectionString: 'postgresql://postgres.iqrhtvwddlqlrenfsaxa:Laesquinadelbillar@aws-1-sa-east-1.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false },
    // [NUEVO] Defensa contra saturación de DB
    max: 20,                      // Máximo 20 conexiones simultáneas
    idleTimeoutMillis: 30000,     // Cierra conexiones inactivas después de 30s
    connectionTimeoutMillis: 2000 // Da error rápido si la DB no responde en 2s (evita bloqueos)
});

// Forzar Hora Perú (UTC-5) para que NOW() sea correcto
pool.on('connect', (client) => {
    client.query("SET TIME ZONE 'America/Lima'");
});

// ==========================================
// 2. MIDDLEWARES GLOBALES
// ==========================================

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(compression()); // [NUEVO] Comprime las respuestas HTTP en un 70%

const loginLimiter = rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: 10, 
    message: { error: "⛔ Demasiados intentos." } 
});

app.use(session({
    store: new pgSession({ pool : pool, tableName : 'session', createTableIfMissing: true }),
    secret: 'secreto_super_seguro_billar_123',
    resave: false, 
    saveUninitialized: false,
    cookie: { secure: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'none' } 
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 3. SEGURIDAD Y CONTROL DE ACCESO
// ==========================================

const verificarSesion = (req, res, next) => {
    if (req.session.usuario) { 
        next(); 
    } else { 
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autorizado.' }); 
        res.redirect('/'); 
    }
};

const soloAdmin = (req, res, next) => {
    if (req.session.usuario && req.session.usuario.rol === 'admin') { 
        next(); 
    } else { 
        res.status(403).json({ error: '⛔ Acceso Denegado.' }); 
    }
};

// ==========================================
// 4. CACHÉ EN MEMORIA RAM (ALTO RENDIMIENTO)
// ==========================================

// Evita hacer consultas SQL innecesarias cada segundo
let configCache = { 
    precio_billar: 10, 
    ultimaActualizacion: 0 
};

async function getPrecioBillar() {
    const AHORA = Date.now();
    // Revalida la caché solo si ha pasado más de 1 minuto
    if (AHORA - configCache.ultimaActualizacion > 60000) {
        try {
            const conf = await pool.query("SELECT valor FROM config WHERE clave = 'precio_billar'");
            configCache.precio_billar = parseFloat(conf.rows[0]?.valor || 10);
            configCache.ultimaActualizacion = AHORA;
        } catch (e) {
            console.error("Error al leer caché:", e);
        }
    }
    return configCache.precio_billar;
}

// ==========================================
// 5. RUTAS HTML Y LOGIN
// ==========================================

app.get('/dashboard.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'dashboard.html')));
app.get('/cocina.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'cocina.html')));
app.get('/cierre_caja.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'cierre_caja.html')));
app.get('/inventario.html', verificarSesion, soloAdmin, (req, res) => res.sendFile(path.join(__dirname, 'private', 'inventario.html')));
app.get('/reportes.html', verificarSesion, soloAdmin, (req, res) => res.sendFile(path.join(__dirname, 'private', 'reportes.html')));

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
app.get('/api/usuario/actual', verificarSesion, (req, res) => { res.json({ username: req.session.usuario.username, rol: req.session.usuario.rol || 'mozo' }); });

// ==========================================
// 6. MANTENIMIENTO AUTOMÁTICO E ÍNDICES
// ==========================================

(async () => {
    try {
        await pool.query("CREATE TABLE IF NOT EXISTS gastos (id SERIAL PRIMARY KEY, descripcion TEXT, monto DECIMAL(10,2), fecha TIMESTAMP DEFAULT NOW())");
        await pool.query("CREATE TABLE IF NOT EXISTS config (clave VARCHAR(50) PRIMARY KEY, valor TEXT)");
        try { await pool.query("INSERT INTO config (clave, valor) VALUES ('precio_billar', '10') ON CONFLICT DO NOTHING"); } catch(e){}
        
        try { await pool.query("ALTER TABLE productos ADD COLUMN categoria VARCHAR(50) DEFAULT 'General'"); } catch (e) {}
        try { await pool.query("ALTER TABLE usuarios ADD COLUMN rol VARCHAR(20) DEFAULT 'admin'"); } catch (e) {}
        try { await pool.query("ALTER TABLE cierres ADD COLUMN total_gastos DECIMAL(10,2) DEFAULT 0"); } catch (e) {}
        try { await pool.query("ALTER TABLE mesas ADD COLUMN tiempo_limite INTEGER DEFAULT 0"); } catch (e) {}
        try { await pool.query("ALTER TABLE pedidos_mesa ADD COLUMN fecha_creacion TIMESTAMP DEFAULT NOW()"); } catch (e) {}
        try { await pool.query("ALTER TABLE pedidos_mesa ADD COLUMN entregado BOOLEAN DEFAULT FALSE"); } catch (e) {}
        try { await pool.query("ALTER TABLE ventas ADD COLUMN metodo_pago VARCHAR(20) DEFAULT 'EFECTIVO'"); } catch (e) {}

        // ÍNDICES PARA BÚSQUEDAS MILISEGUNDO
        try { await pool.query("CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha)"); } catch (e) {}
        try { await pool.query("CREATE INDEX IF NOT EXISTS idx_pedidos_mesa_estado ON pedidos_mesa(mesa_id, pagado)"); } catch (e) {}
        try { await pool.query("CREATE INDEX IF NOT EXISTS idx_pedidos_kds ON pedidos_mesa(pagado, entregado)"); } catch (e) {}
        
        console.log("✅ Base de Datos optimizada y en Caché.");
    } catch (e) {}
})();

// ==========================================
// 7. API: COCINA (KDS)
// ==========================================

app.get('/api/kds/pendientes', verificarSesion, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pm.id, m.numero_mesa, p.nombre, pm.cantidad, p.categoria, 
                   to_char(COALESCE(pm.fecha_creacion, NOW()), 'HH24:MI') as hora
            FROM pedidos_mesa pm
            JOIN mesas m ON pm.mesa_id = m.id
            JOIN productos p ON pm.producto_id = p.id
            WHERE pm.pagado = FALSE AND (pm.entregado IS FALSE OR pm.entregado IS NULL) 
            ORDER BY pm.fecha_creacion ASC
        `);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/kds/entregar/:id', verificarSesion, async (req, res) => {
    try { 
        await pool.query('UPDATE pedidos_mesa SET entregado = TRUE WHERE id = $1', [req.params.id]); 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 8. API: CAJA Y GASTOS (PROMISE.ALL)
// ==========================================

app.post('/api/gastos/nuevo', verificarSesion, async (req, res) => {
    try { 
        await pool.query('INSERT INTO gastos (descripcion, monto) VALUES ($1, $2)', [req.body.descripcion, req.body.monto]); 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/caja/actual', verificarSesion, async (req, res) => {
    try {
        const u = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres"); 
        const f = u.rows[0].fecha;

        // Disparo Simultáneo (Ejecuta todo en paralelo = 5x más rápido)
        const queries = [
            pool.query(`SELECT COALESCE(SUM(total_final), 0) as t FROM ventas WHERE fecha > $1`, [f]), 
            pool.query(`SELECT COALESCE(SUM(monto), 0) as t FROM gastos WHERE fecha > $1`, [f]),      
            pool.query(`SELECT COALESCE(SUM(total_productos), 0) as t FROM ventas WHERE fecha > $1`, [f]), 
            pool.query(`SELECT COALESCE(SUM(total_tiempo), 0) as t FROM ventas WHERE fecha > $1`, [f]),    
            pool.query(`SELECT COALESCE(SUM(total_final), 0) as t FROM ventas WHERE fecha > $1 AND metodo_pago = 'EFECTIVO'`, [f]), 
            pool.query(`SELECT COALESCE(SUM(total_final), 0) as t FROM ventas WHERE fecha > $1 AND (metodo_pago = 'YAPE' OR metodo_pago = 'PLIN')`, [f]), 
            pool.query(`SELECT COALESCE(SUM(total_final), 0) as t FROM ventas WHERE fecha > $1 AND metodo_pago = 'TARJETA'`, [f]), 
            pool.query(`SELECT id, tipo_mesa, total_final, metodo_pago, TO_CHAR(fecha, 'HH24:MI') as hora FROM ventas WHERE fecha > $1 ORDER BY fecha DESC`, [f])
        ];

        const results = await Promise.all(queries);

        const totalVentas = parseFloat(results[0].rows[0].t || 0);
        const totalGastos = parseFloat(results[1].rows[0].t || 0);
        const totalEfectivo = parseFloat(results[4].rows[0].t || 0);
        const totalDigital = parseFloat(results[5].rows[0].t || 0);
        const totalTarjeta = parseFloat(results[6].rows[0].t || 0);

        res.json({ 
            total_ventas: totalVentas, 
            total_gastos: totalGastos, 
            total_caja_real: totalVentas - totalGastos, 
            dinero_en_cajon: totalEfectivo - totalGastos,
            desglose: {
                efectivo: totalEfectivo,
                digital: totalDigital + totalTarjeta
            },
            total_productos: parseFloat(results[2].rows[0].t || 0),
            total_mesas: parseFloat(results[3].rows[0].t || 0),
            lista: results[7].rows
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/caja/cerrar', verificarSesion, async (req, res) => {
    try {
        const u = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres"); 
        const f = u.rows[0].fecha;
        const v = await pool.query(`SELECT COALESCE(SUM(total_final), 0) as total, COUNT(*) as cantidad FROM ventas WHERE fecha > $1`, [f]); 
        const g = await pool.query(`SELECT COALESCE(SUM(monto), 0) as total FROM gastos WHERE fecha > $1`, [f]); 
        
        await pool.query('INSERT INTO cierres (total_ventas, total_gastos, cantidad_mesas, fecha_cierre) VALUES ($1, $2, $3, NOW())', [v.rows[0].total||0, g.rows[0].total||0, v.rows[0].cantidad||0]); 
        res.json({ success: true, total: v.rows[0].total, gastos: g.rows[0].total }); 
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/ventas/eliminar/:id', verificarSesion, soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM ventas WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 9. API: MESAS Y PEDIDOS (CON CACHÉ)
// ==========================================

app.get('/api/mesas', verificarSesion, async (req, res) => {
    try {
        const precio = await getPrecioBillar(); // Usa la RAM ⚡
        
        const r = await pool.query(`
            SELECT *, EXTRACT(EPOCH FROM (NOW() - hora_inicio)) as segundos_transcurridos 
            FROM mesas ORDER BY numero_mesa ASC
        `);
        
        const mesas = r.rows.map(m => ({ 
            ...m, 
            precio_hora: precio, 
            segundos: m.estado === 'OCUPADA' ? parseFloat(m.segundos_transcurridos) : 0 
        }));
        res.json(mesas);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/mesas/abrir/:id', verificarSesion, async (req, res) => {
    try { 
        const l = req.body.minutos ? parseInt(req.body.minutos) : 0; 
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NOW(), tiempo_limite = $2 WHERE id = $3', ['OCUPADA', l, req.params.id]); 
        res.json({ success: true }); 
    } catch(e){ res.status(500).json({ error: e.message }); }
});

app.get('/api/mesas/detalle/:id', verificarSesion, async (req, res) => {
    try {
        const { id } = req.params;
        const precioHora = await getPrecioBillar(); // Usa la RAM ⚡
        
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        let totalT = 0, minReal = 0;
        
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - hora_inicio))/60 AS min FROM mesas WHERE id = $1", [id]);
            minReal = Math.ceil(resT.rows[0].min || 0);
            let tiempoCalculo = minReal - 5; 
            let bloques = Math.ceil(tiempoCalculo / 30); 
            if (bloques < 1) bloques = 1; 
            totalT = (bloques * 30 / 60) * precioHora;
        }
        
        const resProds = await pool.query(`SELECT pm.id, pm.producto_id, p.nombre, pm.cantidad, p.precio_venta FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id WHERE pm.mesa_id = $1 AND pm.pagado = FALSE ORDER BY pm.id ASC`, [id]);
        let totalC = 0; 
        const listaProductos = resProds.rows.map(p => { 
            totalC += p.precio_venta * p.cantidad; 
            return { ...p, subtotal: p.precio_venta * p.cantidad }; 
        });
        
        res.json({ tipo: mesa.tipo, minutos: minReal, totalTiempo: totalT, listaProductos: listaProductos, totalProductos: totalC, totalFinal: totalT + totalC });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/mesas/cerrar/:id', verificarSesion, async (req, res) => {
    const { id } = req.params;
    const metodoPago = req.body.metodo || 'EFECTIVO';

    try {
        const precioHora = await getPrecioBillar(); // Usa la RAM ⚡
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        
        let totalT = 0;
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - hora_inicio))/60 AS min FROM mesas WHERE id = $1", [id]);
            const minReal = Math.ceil(resT.rows[0].min || 0);
            let tiempoCalculo = minReal - 5; 
            let bloques = Math.ceil(tiempoCalculo / 30); 
            if (bloques < 1) bloques = 1;
            totalT = (bloques * 30 / 60) * precioHora;
        }
        
        const resC = await pool.query(`SELECT SUM(p.precio_venta * pm.cantidad) as total FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id WHERE pm.mesa_id = $1 AND pm.pagado = FALSE`, [id]);
        const totalC = parseFloat(resC.rows[0].total || 0);
        const totalF = totalT + totalC;
        
        await pool.query('INSERT INTO ventas (mesa_id, tipo_mesa, total_tiempo, total_productos, total_final, fecha, metodo_pago) VALUES ($1, $2, $3, $4, $5, NOW(), $6)', [id, mesa.tipo, totalT, totalC, totalF, metodoPago]);
        await pool.query('UPDATE pedidos_mesa SET pagado = TRUE WHERE mesa_id = $1', [id]);
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NULL, tiempo_limite = 0 WHERE id = $2', ['LIBRE', id]);
        
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

app.post('/api/pedidos/agregar', verificarSesion, async (req, res) => {
    try {
        await pool.query('INSERT INTO pedidos_mesa (mesa_id, producto_id, cantidad, fecha_creacion, entregado) VALUES ($1, $2, $3, NOW(), FALSE)', [req.body.mesa_id, req.body.producto_id, req.body.cantidad]);
        await pool.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [req.body.cantidad, req.body.producto_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/pedidos/eliminar/:id', verificarSesion, async (req, res) => {
    try {
        const p = await pool.query('SELECT producto_id, cantidad FROM pedidos_mesa WHERE id = $1', [req.params.id]);
        if (p.rows.length > 0) {
            await pool.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [p.rows[0].cantidad, p.rows[0].producto_id]);
            await pool.query('DELETE FROM pedidos_mesa WHERE id = $1', [req.params.id]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 10. API: ADMIN (PRODUCTOS, CONFIG Y ESTADÍSTICAS)
// ==========================================

app.get('/api/productos', verificarSesion, async (req, res) => {
    try { 
        const r = await pool.query('SELECT * FROM productos ORDER BY nombre ASC'); 
        res.json(r.rows); 
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/productos/nuevo', verificarSesion, soloAdmin, async (req, res) => {
    try { 
        await pool.query('INSERT INTO productos (nombre, precio_venta, stock, categoria) VALUES ($1, $2, $3, $4)', [req.body.nombre, req.body.precio, req.body.stock||0, req.body.categoria||'General']); 
        res.json({success:true}); 
    } catch(e){ res.status(500).json({error:e.message}) }
});

app.delete('/api/productos/eliminar/:id', verificarSesion, soloAdmin, async (req, res) => {
    try { 
        await pool.query('DELETE FROM pedidos_mesa WHERE producto_id = $1', [req.params.id]); 
        await pool.query('DELETE FROM productos WHERE id = $1', [req.params.id]); 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: 'Error al eliminar' }); }
});

app.post('/api/productos/agregar-stock', verificarSesion, soloAdmin, async (req, res) => {
    try { 
        const { id, cantidad, costo, nombre } = req.body; 
        await pool.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [cantidad, id]); 
        if (costo && parseFloat(costo) > 0) { 
            await pool.query('INSERT INTO gastos (descripcion, monto) VALUES ($1, $2)', [`Compra Inv: ${nombre} (+${cantidad})`, costo]); 
        } 
        res.json({success:true}); 
    } catch(e){ res.status(500).json({error:e.message}) }
});

app.get('/api/config', async (req, res) => {
    try { 
        const r = await pool.query("SELECT * FROM config"); 
        res.json(r.rows); 
    } catch (e) { res.status(500).json({error:e.message})}
});

app.post('/api/config', verificarSesion, soloAdmin, async (req, res) => {
    try { 
        await pool.query("UPDATE config SET valor = $1 WHERE clave = 'precio_billar'", [req.body.precio_billar]); 
        // [NUEVO] Invalidamos la caché al instante si cambian el precio
        configCache.ultimaActualizacion = 0; 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({error:e.message})}
});

app.get('/api/estadisticas/semana', verificarSesion, soloAdmin, async (req, res) => {
    try { 
        const v = await pool.query(`SELECT TO_CHAR(fecha, 'DD/MM') as dia, SUM(total_final) as total FROM ventas WHERE fecha > NOW() - INTERVAL '7 days' GROUP BY dia ORDER BY MIN(fecha) ASC`); 
        const p = await pool.query(`SELECT p.nombre, SUM(pm.cantidad) as cantidad FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id GROUP BY p.nombre ORDER BY cantidad DESC LIMIT 5`); 
        res.json({ ventas: v.rows, top_productos: p.rows }); 
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/reportes/eliminar/:id', verificarSesion, soloAdmin, async (req, res) => {
    try { 
        const t = await pool.query('SELECT fecha_cierre FROM cierres WHERE id = $1', [req.params.id]); 
        if (t.rows.length === 0) return res.status(404).json({ error: 'Reporte no encontrado' }); 
        const f = t.rows[0].fecha_cierre; 
        const p = await pool.query('SELECT MAX(fecha_cierre) as fecha FROM cierres WHERE fecha_cierre < $1', [f]); 
        const fa = p.rows[0].fecha || '2000-01-01'; 
        await pool.query('DELETE FROM ventas WHERE fecha > $1 AND fecha <= $2', [fa, f]); 
        await pool.query('DELETE FROM cierres WHERE id = $1', [req.params.id]); 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reportes/historial', verificarSesion, soloAdmin, async (req, res) => {
    try { 
        const r = await pool.query('SELECT * FROM cierres ORDER BY fecha_cierre DESC LIMIT 30'); 
        res.json(r.rows); 
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 11. INICIO DE SERVIDOR
// ==========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎱 Servidor Optimizado y Comprimido corriendo en puerto ${PORT}`));