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

// SEGURIDAD
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

// RUTAS HTML
app.get('/dashboard.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'dashboard.html')));
app.get('/cocina.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'cocina.html'))); // <--- RUTA DE COCINA
app.get('/inventario.html', verificarSesion, (req, res) => { if(req.session.usuario.rol !== 'admin') return res.redirect('/dashboard.html'); res.sendFile(path.join(__dirname, 'private', 'inventario.html')); });
app.get('/reportes.html', verificarSesion, (req, res) => { if(req.session.usuario.rol !== 'admin') return res.redirect('/dashboard.html'); res.sendFile(path.join(__dirname, 'private', 'reportes.html')); });
app.get('/cierre_caja.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'cierre_caja.html')));

// LOGIN
app.post(['/login', '/api/login'], loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM usuarios WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) { req.session.usuario = result.rows[0]; res.json({ success: true, rol: result.rows[0].rol }); } 
        else { res.status(401).json({ success: false }); }
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });
app.get('/api/usuario/actual', verificarSesion, (req, res) => { res.json({ username: req.session.usuario.username, rol: req.session.usuario.rol || 'mozo' }); });

// --- API ---

// [AUTO-MIGRACIONES CRÍTICAS] 🔧
(async () => {
    try { await pool.query("ALTER TABLE productos ADD COLUMN categoria VARCHAR(50) DEFAULT 'General'"); } catch (e) {}
    try { await pool.query("ALTER TABLE usuarios ADD COLUMN rol VARCHAR(20) DEFAULT 'admin'"); } catch (e) {}
    try { await pool.query("CREATE TABLE IF NOT EXISTS gastos (id SERIAL PRIMARY KEY, descripcion TEXT, monto DECIMAL(10,2), fecha TIMESTAMP DEFAULT NOW())"); } catch (e) {}
    try { await pool.query("ALTER TABLE cierres ADD COLUMN total_gastos DECIMAL(10,2) DEFAULT 0"); } catch (e) {}
    try { await pool.query("ALTER TABLE mesas ADD COLUMN tiempo_limite INTEGER DEFAULT 0"); } catch (e) {} 
    
    // [ESTA ES LA NUEVA] Agregamos fecha a los pedidos para la cocina
    try { 
        await pool.query("ALTER TABLE pedidos_mesa ADD COLUMN fecha_creacion TIMESTAMP DEFAULT NOW()"); 
        console.log("✅ Columna fecha_creacion creada en pedidos.");
    } catch (e) {}

    // Tabla Configuración
    try {
        await pool.query("CREATE TABLE IF NOT EXISTS config (clave VARCHAR(50) PRIMARY KEY, valor TEXT)");
        await pool.query("INSERT INTO config (clave, valor) VALUES ('precio_billar', '10') ON CONFLICT DO NOTHING");
    } catch (e) {}
})();

// KDS COCINA
app.get('/api/kds/pendientes', verificarSesion, async (req, res) => {
    try {
        // Obtenemos pedidos no pagados. Usamos COALESCE para evitar error si fecha es null
        const result = await pool.query(`
            SELECT pm.id, m.numero_mesa, p.nombre, pm.cantidad, p.categoria, 
                   to_char(COALESCE(pm.fecha_creacion, NOW()), 'HH24:MI') as hora
            FROM pedidos_mesa pm
            JOIN mesas m ON pm.mesa_id = m.id
            JOIN productos p ON pm.producto_id = p.id
            WHERE pm.pagado = FALSE 
            ORDER BY pm.id DESC
        `);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GASTOS Y CAJA
app.post('/api/gastos/nuevo', verificarSesion, async (req, res) => {
    try { await pool.query('INSERT INTO gastos (descripcion, monto) VALUES ($1, $2)', [req.body.descripcion, req.body.monto]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/caja/actual', verificarSesion, async (req, res) => {
    try {
        const u = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres");
        const f = u.rows[0].fecha;
        const v = await pool.query(`SELECT COALESCE(SUM(total_final), 0) as t FROM ventas WHERE fecha > $1`, [f]);
        const g = await pool.query(`SELECT COALESCE(SUM(monto), 0) as t FROM gastos WHERE fecha > $1`, [f]);
        const p = await pool.query(`SELECT COALESCE(SUM(total_productos), 0) as t FROM ventas WHERE fecha > $1`, [f]);
        const m = await pool.query(`SELECT COALESCE(SUM(total_tiempo), 0) as t FROM ventas WHERE fecha > $1`, [f]);
        const l = await pool.query(`SELECT id, tipo_mesa, total_final, TO_CHAR(fecha, 'HH24:MI') as hora FROM ventas WHERE fecha > $1 ORDER BY fecha DESC`, [f]);

        res.json({ 
            total_ventas: parseFloat(v.rows[0].t), 
            total_gastos: parseFloat(g.rows[0].t), 
            total_caja_real: parseFloat(v.rows[0].t)-parseFloat(g.rows[0].t),
            total_productos: parseFloat(p.rows[0].t),
            total_mesas: parseFloat(m.rows[0].t),
            lista: l.rows
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

// CONFIG Y ESTADÍSTICAS
app.get('/api/config', async (req, res) => { try { const r = await pool.query("SELECT * FROM config"); res.json(r.rows); } catch (e) { res.status(500).json({error:e.message})} });
app.post('/api/config', verificarSesion, soloAdmin, async (req, res) => { try { await pool.query("UPDATE config SET valor = $1 WHERE clave = 'precio_billar'", [req.body.precio_billar]); res.json({ success: true }); } catch (e) { res.status(500).json({error:e.message})} });
app.get('/api/estadisticas/semana', verificarSesion, soloAdmin, async (req, res) => {
    try {
        const v = await pool.query(`SELECT TO_CHAR(fecha, 'DD/MM') as dia, SUM(total_final) as total FROM ventas WHERE fecha > NOW() - INTERVAL '7 days' GROUP BY dia ORDER BY MIN(fecha) ASC`);
        const p = await pool.query(`SELECT p.nombre, SUM(pm.cantidad) as cantidad FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id GROUP BY p.nombre ORDER BY cantidad DESC LIMIT 5`);
        res.json({ ventas: v.rows, top_productos: p.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// MESAS (Con precio dinámico)
app.get('/api/mesas', verificarSesion, async (req, res) => {
    try {
        const conf = await pool.query("SELECT valor FROM config WHERE clave = 'precio_billar'");
        const precio = parseFloat(conf.rows[0]?.valor || 10);
        const r = await pool.query('SELECT * FROM mesas ORDER BY numero_mesa ASC');
        const mesas = r.rows.map(m => ({ ...m, precio_hora: precio }));
        res.json(mesas);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ACCIONES
app.get('/api/productos', verificarSesion, async (req, res) => { try { const r = await pool.query('SELECT * FROM productos ORDER BY nombre ASC'); res.json(r.rows); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/mesas/abrir/:id', verificarSesion, async (req, res) => { try { const l = req.body.minutos ? parseInt(req.body.minutos) : 0; await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NOW(), tiempo_limite = $2 WHERE id = $3', ['OCUPADA', l, req.params.id]); res.json({success:true}); } catch(e){res.status(500).json({error:e.message})} });
app.post('/api/mesas/cerrar/:id', verificarSesion, async (req, res) => {
    const { id } = req.params;
    try {
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        // Buscamos precio actual para calcular cierre correctamente
        const conf = await pool.query("SELECT valor FROM config WHERE clave = 'precio_billar'");
        const precioHora = parseFloat(conf.rows[0]?.valor || 10);
        
        let totalT = 0;
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - $1))/60 AS min", [mesa.hora_inicio]);
            const minReal = Math.ceil(resT.rows[0].min || 0);
            let tiempoCalculo = minReal - 5; let bloques = Math.ceil(tiempoCalculo / 30); if (bloques < 1) bloques = 1;
            totalT = (bloques * 30 / 60) * precioHora;
        }
        const resC = await pool.query(`SELECT SUM(p.precio_venta * pm.cantidad) as total FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id WHERE pm.mesa_id = $1 AND pm.pagado = FALSE`, [id]);
        const totalC = parseFloat(resC.rows[0].total || 0); const totalF = totalT + totalC;
        await pool.query('INSERT INTO ventas (mesa_id, tipo_mesa, total_tiempo, total_productos, total_final, fecha) VALUES ($1, $2, $3, $4, $5, NOW())', [id, mesa.tipo, totalT, totalC, totalF]);
        await pool.query('UPDATE pedidos_mesa SET pagado = TRUE WHERE mesa_id = $1', [id]);
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NULL, tiempo_limite = 0 WHERE id = $2', ['LIBRE', id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PEDIDOS (Con Fecha)
app.post('/api/pedidos/agregar', verificarSesion, async (req, res) => { 
    try { 
        // [MEJORADO] Insertamos con fecha NOW() explícita
        await pool.query('INSERT INTO pedidos_mesa (mesa_id, producto_id, cantidad, fecha_creacion) VALUES ($1, $2, $3, NOW())', [req.body.mesa_id, req.body.producto_id, req.body.cantidad]); 
        await pool.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [req.body.cantidad, req.body.producto_id]); 
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: e.message }); } 
});

app.delete('/api/pedidos/eliminar/:id', verificarSesion, async (req, res) => { try { const p = await pool.query('SELECT producto_id, cantidad FROM pedidos_mesa WHERE id = $1', [req.params.id]); if (p.rows.length > 0) { await pool.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [p.rows[0].cantidad, p.rows[0].producto_id]); await pool.query('DELETE FROM pedidos_mesa WHERE id = $1', [req.params.id]); } res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/mesas/cambiar', verificarSesion, async (req, res) => { try { const { idOrigen, idDestino } = req.body; const origen = await pool.query('SELECT * FROM mesas WHERE id = $1', [idOrigen]); const destino = await pool.query('SELECT * FROM mesas WHERE id = $1', [idDestino]); if(origen.rows[0].estado !== 'OCUPADA') return res.status(400).json({error: 'Mesa origen no ocupada'}); if(destino.rows[0].estado !== 'LIBRE') return res.status(400).json({error: 'Mesa destino ocupada'}); const horaInicio = origen.rows[0].hora_inicio; await pool.query('UPDATE mesas SET estado = $1, hora_inicio = $2 WHERE id = $3', ['OCUPADA', horaInicio, idDestino]); await pool.query('UPDATE pedidos_mesa SET mesa_id = $1 WHERE mesa_id = $2', [idDestino, idOrigen]); await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NULL WHERE id = $2', ['LIBRE', idOrigen]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/mesas/detalle/:id', verificarSesion, async (req, res) => {
    try {
        const { id } = req.params; const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        // Precio dinámico
        const conf = await pool.query("SELECT valor FROM config WHERE clave = 'precio_billar'");
        const precioHora = parseFloat(conf.rows[0]?.valor || 10);

        let totalT = 0, minReal = 0;
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - $1))/60 AS min", [mesa.hora_inicio]);
            minReal = Math.ceil(resT.rows[0].min || 0);
            let tiempoCalculo = minReal - 5; let bloques = Math.ceil(tiempoCalculo / 30); if (bloques < 1) bloques = 1; 
            totalT = (bloques * 30 / 60) * precioHora;
        }
        const resProds = await pool.query(`SELECT pm.id, pm.producto_id, p.nombre, pm.cantidad, p.precio_venta FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id WHERE pm.mesa_id = $1 AND pm.pagado = FALSE ORDER BY pm.id ASC`, [id]);
        let totalC = 0; const listaProductos = resProds.rows.map(p => { totalC += p.precio_venta * p.cantidad; return { ...p, subtotal: p.precio_venta * p.cantidad }; });
        res.json({ tipo: mesa.tipo, minutos: minReal, totalTiempo: totalT, listaProductos: listaProductos, totalProductos: totalC, totalFinal: totalT + totalC });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ADMIN ROUTES
app.post('/api/productos/nuevo', verificarSesion, soloAdmin, async (req, res) => { try { await pool.query('INSERT INTO productos (nombre, precio_venta, stock, categoria) VALUES ($1, $2, $3, $4)', [req.body.nombre, req.body.precio, req.body.stock||0, req.body.categoria||'General']); res.json({success:true}); } catch(e){res.status(500).json({error:e.message})} });
app.delete('/api/productos/eliminar/:id', verificarSesion, soloAdmin, async (req, res) => { try { await pool.query('DELETE FROM pedidos_mesa WHERE producto_id = $1', [req.params.id]); await pool.query('DELETE FROM productos WHERE id = $1', [req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Error al eliminar' }); } });
app.post('/api/productos/agregar-stock', verificarSesion, soloAdmin, async (req, res) => { 
    try { 
        const { id, cantidad, costo, nombre } = req.body;
        await pool.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [cantidad, id]); 
        if (costo && parseFloat(costo) > 0) {
            await pool.query('INSERT INTO gastos (descripcion, monto) VALUES ($1, $2)', [`Compra Inv: ${nombre}`, costo]);
        }
        res.json({success:true}); 
    } catch(e){res.status(500).json({error:e.message})} 
});
app.delete('/api/reportes/eliminar/:id', verificarSesion, soloAdmin, async (req, res) => { try { const t = await pool.query('SELECT fecha_cierre FROM cierres WHERE id = $1', [req.params.id]); if (t.rows.length === 0) return res.status(404).json({ error: 'Reporte no encontrado' }); const f = t.rows[0].fecha_cierre; const p = await pool.query('SELECT MAX(fecha_cierre) as fecha FROM cierres WHERE fecha_cierre < $1', [f]); const fa = p.rows[0].fecha || '2000-01-01'; await pool.query('DELETE FROM ventas WHERE fecha > $1 AND fecha <= $2', [fa, f]); await pool.query('DELETE FROM cierres WHERE id = $1', [req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/reportes/historial', verificarSesion, soloAdmin, async (req, res) => { try { const r = await pool.query('SELECT * FROM cierres ORDER BY fecha_cierre DESC LIMIT 30'); res.json(r.rows); } catch (e) { res.status(500).json({ error: e.message }); } });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎱 Servidor Maestro activo en ${PORT}`));