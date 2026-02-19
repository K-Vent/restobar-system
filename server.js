/* ============================================================
   SERVER.JS - SISTEMA GESTIÓN "LA ESQUINA DEL BILLAR"
   Versión: Profesional / Ingeniería
   ============================================================ */

require('dotenv').config();
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const path = require('path');
const cors = require('cors'); 
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet'); 
const rateLimit = require('express-rate-limit'); 
const compression = require('compression'); 
const bcrypt = require('bcrypt'); 
const { z } = require('zod'); 

const pool = require('./db.js'); 

const app = express(); 
const server = http.createServer(app); 
const io = new Server(server); 

// ==========================================
// 1. ESQUEMAS DE VALIDACIÓN (ZOD)
// ==========================================
const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
const gastoSchema = z.object({ descripcion: z.string().min(1), monto: z.coerce.number().positive() });
const abrirMesaSchema = z.object({ minutos: z.coerce.number().int().nonnegative().default(0) });
const cerrarMesaSchema = z.object({ 
    metodo: z.enum(['EFECTIVO', 'YAPE', 'PLIN', 'TARJETA', 'MIXTO']).default('EFECTIVO'),
    pago_efectivo: z.coerce.number().nonnegative().optional(),
    pago_digital: z.coerce.number().nonnegative().optional()
});
const pedidoSchema = z.object({ mesa_id: z.coerce.number().int().positive(), producto_id: z.coerce.number().int().positive(), cantidad: z.coerce.number().int().positive() });
const nuevoProductoSchema = z.object({ nombre: z.string().min(1), precio: z.coerce.number().positive(), stock: z.coerce.number().int().nonnegative().default(0), categoria: z.string().default('General') });

// ==========================================
// 2. MIDDLEWARES DE SEGURIDAD
// ==========================================
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(compression()); 
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    store: new pgSession({ pool : pool, tableName : 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET, 
    resave: false, 
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 60 * 60 * 1000 } 
}));

// --- MIDDLEWARES DE ACCESO (ADMIN/MOZO) ---
const verificarSesion = (req, res, next) => { 
    if (req.session.usuario) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autorizado.' });
    res.redirect('/'); 
};

const soloAdmin = (req, res, next) => { 
    if (req.session.usuario && req.session.usuario.rol === 'admin') return next();
    res.status(403).json({ error: '⛔ Acceso Denegado. Se requiere perfil de Administrador.' }); 
};

// ==========================================
// 3. RUTAS API - SEGURIDAD Y SESIÓN
// ==========================================
app.post('/api/login', async (req, res, next) => {
    try { 
        const { username, password } = loginSchema.parse(req.body); 
        const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]); 
        if (result.rows.length > 0) { 
            const user = result.rows[0]; 
            const passwordCorrecta = await bcrypt.compare(password, user.password);
            if (passwordCorrecta) { 
                req.session.usuario = { id: user.id, username: user.username, rol: user.rol }; 
                return res.json({ success: true, rol: user.rol }); 
            }
        }
        res.status(401).json({ success: false }); 
    } catch (e) { next(e); } 
});

app.get('/api/usuario/actual', verificarSesion, (req, res) => res.json({ username: req.session.usuario.username, rol: req.session.usuario.rol }));
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

// ==========================================
// 4. RUTAS DE ADMINISTRADOR (SOLO KEVIN)
// ==========================================
app.get('/api/reportes/historial', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const r = await pool.query('SELECT * FROM cierres ORDER BY fecha_cierre DESC LIMIT 30'); 
        res.json(r.rows); 
    } catch (e) { next(e); } 
});

app.delete('/api/ventas/eliminar/:id', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const id = z.coerce.number().int().parse(req.params.id); 
        await pool.query('DELETE FROM ventas WHERE id = $1', [id]); 
        res.json({ success: true }); 
        io.emit('actualizar_caja'); 
    } catch (e) { next(e); } 
});

app.post('/api/productos/nuevo', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const v = nuevoProductoSchema.parse(req.body); 
        await pool.query('INSERT INTO productos (nombre, precio_venta, stock, categoria) VALUES ($1, $2, $3, $4)', [v.nombre, v.precio, v.stock, v.categoria]); 
        res.json({ success: true }); 
    } catch (e) { next(e); } 
});

// ==========================================
// 5. RUTAS OPERATIVAS (MESAS, PEDIDOS, PAGOS)
// ==========================================
app.get('/api/mesas', verificarSesion, async (req, res, next) => {
    try {
        const conf = await pool.query("SELECT valor FROM config WHERE clave = 'precio_billar'");
        const precio = parseFloat(conf.rows[0]?.valor || 10);
        const r = await pool.query(`SELECT *, EXTRACT(EPOCH FROM (NOW() - hora_inicio)) as segundos_transcurridos FROM mesas ORDER BY numero_mesa ASC`);
        res.json(r.rows.map(m => ({ ...m, precio_hora: precio, segundos: m.estado === 'OCUPADA' ? parseFloat(m.segundos_transcurridos) : 0 })));
    } catch (e) { next(e); }
});

app.post('/api/mesas/cerrar/:id', verificarSesion, async (req, res, next) => {
    try {
        const id = z.coerce.number().int().parse(req.params.id);
        const val = cerrarMesaSchema.parse(req.body);
        
        // Lógica de cálculo (Tiempo + Productos)
        const mesa = (await pool.query('SELECT * FROM mesas WHERE id = $1', [id])).rows[0];
        let totalT = 0;
        if (mesa.tipo === 'BILLAR' && mesa.hora_inicio) {
            const resT = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - hora_inicio))/60 AS min FROM mesas WHERE id = $1", [id]);
            let bloques = Math.ceil((Math.ceil(resT.rows[0].min || 0) - 5) / 30);
            if (bloques < 1) bloques = 1;
            const conf = await pool.query("SELECT valor FROM config WHERE clave = 'precio_billar'");
            totalT = (bloques * 30 / 60) * parseFloat(conf.rows[0]?.valor || 10);
        }
        
        const resP = await pool.query(`SELECT SUM(p.precio_venta * pm.cantidad) as total FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id WHERE pm.mesa_id = $1 AND pm.pagado = FALSE`, [id]);
        const totalC = parseFloat(resP.rows[0].total || 0);
        const totalF = totalT + totalC;

        const ef = val.metodo === 'MIXTO' ? (val.pago_efectivo || 0) : (val.metodo === 'EFECTIVO' ? totalF : 0);
        const dig = val.metodo === 'MIXTO' ? (val.pago_digital || 0) : (val.metodo !== 'EFECTIVO' && val.metodo !== 'MIXTO' ? totalF : 0);

        await pool.query('INSERT INTO ventas (mesa_id, tipo_mesa, total_tiempo, total_productos, total_final, fecha, metodo_pago, pago_efectivo, pago_digital) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)', 
            [id, mesa.tipo, totalT, totalC, totalF, val.metodo, ef, dig]);
        
        await pool.query('UPDATE pedidos_mesa SET pagado = TRUE WHERE mesa_id = $1', [id]);
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NULL WHERE id = $2', ['LIBRE', id]);
        
        res.json({ success: true }); 
        io.emit('actualizar_mesas'); 
        io.emit('actualizar_caja');
    } catch (e) { next(e); }
});

// ==========================================
// 6. KDS Y MANEJO DE ERRORES
// ==========================================
app.get('/api/kds/pendientes', verificarSesion, async (req, res, next) => {
    try { 
        const r = await pool.query(`SELECT pm.id, m.numero_mesa, p.nombre, pm.cantidad FROM pedidos_mesa pm JOIN mesas m ON pm.mesa_id = m.id JOIN productos p ON pm.producto_id = p.id WHERE pm.pagado = FALSE AND pm.entregado = FALSE`); 
        res.json(r.rows); 
    } catch (e) { next(e); }
});

app.use((err, req, res, next) => {
    console.error("🔥 Error Central:", err.message);
    if (err instanceof z.ZodError) return res.status(400).json({ error: "Datos inválidos." });
    res.status(500).json({ error: "Error interno del servidor." });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎱 "La Esquina" corriendo en el puerto ${PORT}`));