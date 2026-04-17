/* ============================================================
   SERVER.JS - SISTEMA GESTIÓN "LA ESQUINA DEL BILLAR"
   Arquitectura: Stateless (JWT) / Ultra-Rápido
   ============================================================ */

require('dotenv').config();
const express = require('express');
const { verificarSesion, soloAdmin } = require('./middlewares/auth.middleware');
const http = require('http'); 
const { Server } = require('socket.io'); 
const path = require('path');
const cors = require('cors'); 
const helmet = require('helmet'); 
const rateLimit = require('express-rate-limit'); 
const compression = require('compression'); 
const bcrypt = require('bcrypt'); 
const { z } = require('zod'); 

// --- NUEVAS LIBRERÍAS DE ALTA VELOCIDAD ---
const jwt = require('jsonwebtoken'); 
const cookieParser = require('cookie-parser');

const pool = require('./db.js'); 

const app = express(); 
const server = http.createServer(app); 
const io = new Server(server); 
app.set('socketio', io);

// Llave maestra criptográfica
const SECRET_KEY = process.env.JWT_SECRET || 'llave_maestra_billar_2026';

// ==========================================
// 1. ESQUEMAS DE VALIDACIÓN DE DATOS (ZOD)
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
const cambiarMesaSchema = z.object({ idOrigen: z.coerce.number().int().positive(), idDestino: z.coerce.number().int().positive() });
const nuevoProductoSchema = z.object({ nombre: z.string().min(1), precio: z.coerce.number().positive(), stock: z.coerce.number().int().nonnegative().default(0), categoria: z.string().default('General') });
const stockSchema = z.object({ id: z.coerce.number().int().positive(), cantidad: z.coerce.number().int().positive(), costo: z.coerce.number().nonnegative().optional(), nombre: z.string() });
const usuarioSchema = z.object({ 
    username: z.string().min(3, "El usuario debe tener al menos 3 letras"), 
    password: z.string().min(4, "La contraseña debe tener al menos 4 caracteres"), 
    rol: z.enum(['admin', 'mozo', 'cocina']).default('mozo') 
});
// ==========================================
// 2. CONFIGURACIÓN DEL SERVIDOR
// ==========================================
io.on('connection', (socket) => { console.log('📱 Dispositivo conectado:', socket.id); });

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(compression()); 
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser()); // Activa la lectura de cookies de alta velocidad
// 👇 CONEXIÓN DE MÓDULOS MVC 👇
app.use('/api/usuarios', require('./routes/usuarios.routes'));
app.use('/api/productos', require('./routes/inventario.routes'));
app.use('/api/mesas', require('./routes/mesas.routes'));
app.use('/api', require('./routes/vip.routes')); // <-- Agrega esta línea
const auditoriaRoutes = require('./routes/auditoria.routes');
app.use('/api/auditoria', auditoriaRoutes);
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: "⛔ Demasiados intentos." } });



// ==========================================
// 4. RUTAS DE VISTAS (FRONTEND PROTEGIDO)
// ==========================================
app.get('/dashboard.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'dashboard.html')));
app.get('/cocina.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'cocina.html')));
app.get('/cierre_caja.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'cierre_caja.html')));
app.get('/clientes.html', verificarSesion, (req, res) => res.sendFile(path.join(__dirname, 'private', 'clientes.html')));
app.get('/inventario.html', verificarSesion, soloAdmin, (req, res) => res.sendFile(path.join(__dirname, 'private', 'inventario.html')));
app.get('/reportes.html', verificarSesion, soloAdmin, (req, res) => res.sendFile(path.join(__dirname, 'private', 'reportes.html')));
app.get('/auditoria.html', verificarSesion, soloAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'private', 'auditoria.html'));
});
app.get('/empleados.html', verificarSesion, soloAdmin, (req, res) => res.sendFile(path.join(__dirname, 'private', 'empleados.html')));
// ==========================================
// 5. INICIALIZACIÓN AUTOMÁTICA DE BD
// ==========================================
let configCache = { precio_billar: 10, ultimaActualizacion: 0 };
async function getPrecioBillar() {
    const AHORA = Date.now();
    if (AHORA - configCache.ultimaActualizacion > 60000) { 
        try { 
            const conf = await pool.query("SELECT valor FROM config WHERE clave = 'precio_billar'"); 
            configCache.precio_billar = parseFloat(conf.rows[0]?.valor || 10); 
            configCache.ultimaActualizacion = AHORA; 
        } catch (e) {} 
    }
    return configCache.precio_billar;
}

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
        try { await pool.query("ALTER TABLE ventas ADD COLUMN pago_efectivo DECIMAL(10,2) DEFAULT 0"); } catch (e) {} 
        try { await pool.query("ALTER TABLE ventas ADD COLUMN pago_digital DECIMAL(10,2) DEFAULT 0"); } catch (e) {}
        try { await pool.query("DROP TABLE IF EXISTS session CASCADE"); } catch(e){} // Eliminamos la tabla obsoleta
        // 👇 AÑADIR ESTA LÍNEA PARA CREAR LA TABLA DE CLIENTES 👇
        try { 
            await pool.query(`
                CREATE TABLE IF NOT EXISTS clientes (
                    id SERIAL PRIMARY KEY, 
                    nombre VARCHAR(100) NOT NULL, 
                    telefono VARCHAR(20) UNIQUE, 
                    sellos INTEGER DEFAULT 0, 
                    nivel VARCHAR(20) DEFAULT 'Bronce', 
                    fecha_registro TIMESTAMP DEFAULT NOW()
                )
            `); 
        } catch (e) { console.log("Error creando tabla clientes:", e); }
        try { await pool.query("ALTER TABLE clientes ADD COLUMN pin VARCHAR(4) DEFAULT '1234'"); } catch (e) {}
        try { 
            await pool.query(`
                CREATE TABLE IF NOT EXISTS beneficios (
                    id SERIAL PRIMARY KEY, 
                    nivel VARCHAR(20) NOT NULL, 
                    descripcion TEXT NOT NULL
                )
            `); 
        } catch (e) { console.log("Error creando tabla beneficios:", e); }
    } catch (e) { console.error("Error en inicialización de BD:", e); } 
    try { 
            await pool.query(`
                CREATE TABLE IF NOT EXISTS auditoria (
                    id SERIAL PRIMARY KEY, 
                    usuario_id INTEGER, 
                    accion VARCHAR(100), 
                    detalles TEXT, 
                    fecha TIMESTAMP DEFAULT NOW()
                )
            `); 
        } catch (e) { console.log("Error creando tabla auditoria:", e); }
})();

// ==========================================
// 6. RUTAS API: AUTENTICACIÓN (NUEVO JWT)
// ==========================================
app.post(['/login', '/api/login'], loginLimiter, async (req, res, next) => {
    try { 
        const { username, password } = loginSchema.parse(req.body); 
        const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]); 
        
        if (result.rows.length > 0) { 
            const user = result.rows[0]; 
            let passwordCorrecta = false; 
            
            if (user.password.startsWith('$2')) { 
                passwordCorrecta = await bcrypt.compare(password, user.password); 
            } else { 
                if (user.password === password) { 
                    passwordCorrecta = true; 
                    const hashedPassword = await bcrypt.hash(password, 10); 
                    await pool.query('UPDATE usuarios SET password = $1 WHERE id = $2', [hashedPassword, user.id]); 
                } 
            } 
            
            if (passwordCorrecta) { 
                // Creamos el Token firmado digitalmente (Válido por 12 horas)
                const token = jwt.sign(
                    { id: user.id, username: user.username, rol: user.rol }, 
                    SECRET_KEY, 
                    { expiresIn: '12h' }
                );

                // Lo inyectamos en una cookie de altísima seguridad
                res.cookie('token', token, { 
                    httpOnly: true, 
                    secure: process.env.NODE_ENV === 'production', 
                    maxAge: 12 * 60 * 60 * 1000 
                });

                return res.json({ success: true, rol: user.rol }); 
            } 
        } 
        res.status(401).json({ success: false, error: 'Credenciales incorrectas' }); 
    } catch (e) { next(e); } 
});

app.get('/logout', (req, res) => { 
    res.clearCookie('token'); 
    res.redirect('/'); 
});

app.get('/api/usuario/actual', verificarSesion, (req, res) => { 
    res.json({ username: req.usuario.username, rol: req.usuario.rol || 'mozo' }); 
});
// ==========================================
// RUTAS PÚBLICAS (MENÚ QR PARA CLIENTES)
// ==========================================
app.get('/api/menu/publico', async (req, res, next) => { 
    try { 
        // Solo enviamos nombre, precio y categoría de los productos con stock > 0.
        // Ocultamos el ID, el stock real y cualquier otro dato administrativo.
        const r = await pool.query('SELECT nombre, precio_venta, categoria FROM productos WHERE stock > 0 ORDER BY categoria, nombre ASC'); 
        res.json(r.rows); 
    } catch (e) { next(e); } 
});
// ==========================================
// 7. RUTAS API: COCINA Y KDS
// ==========================================
app.get('/api/kds/pendientes', verificarSesion, async (req, res, next) => { 
    try { 
        const result = await pool.query(`SELECT pm.id, m.numero_mesa, p.nombre, pm.cantidad, p.categoria, to_char(COALESCE(pm.fecha_creacion, NOW()), 'HH24:MI') as hora FROM pedidos_mesa pm JOIN mesas m ON pm.mesa_id = m.id JOIN productos p ON pm.producto_id = p.id WHERE pm.pagado = FALSE AND (pm.entregado IS FALSE OR pm.entregado IS NULL) ORDER BY pm.fecha_creacion ASC`); 
        res.json(result.rows); 
    } catch (e) { next(e); } 
});

app.post('/api/kds/entregar/:id', verificarSesion, async (req, res, next) => { 
    try { 
        const id = z.coerce.number().int().parse(req.params.id); 
        await pool.query('UPDATE pedidos_mesa SET entregado = TRUE WHERE id = $1', [id]); 
        res.json({ success: true }); io.emit('actualizar_cocina'); 
    } catch (e) { next(e); } 
});

// ==========================================
// 8. RUTAS API: OPERATIVA DE MESAS
// ==========================================


// ==========================================
// 9. RUTAS API: PEDIDOS
// ==========================================
app.post('/api/pedidos/agregar', verificarSesion, async (req, res, next) => { 
    try { 
        const val = pedidoSchema.parse(req.body); 
        await pool.query('INSERT INTO pedidos_mesa (mesa_id, producto_id, cantidad, fecha_creacion, entregado) VALUES ($1, $2, $3, NOW(), FALSE)', [val.mesa_id, val.producto_id, val.cantidad]); 
        await pool.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [val.cantidad, val.producto_id]); 
        const mesaDb = await pool.query('SELECT numero_mesa FROM mesas WHERE id = $1', [val.mesa_id]);
        const prodDb = await pool.query('SELECT nombre FROM productos WHERE id = $1', [val.producto_id]);
        await pool.query(
            "INSERT INTO auditoria (usuario_id, accion, detalles) VALUES ($1, 'NUEVO PEDIDO', 'Añadió ' || $2 || 'x ' || $3 || ' a Mesa ' || $4)", 
            [req.usuario.id, val.cantidad, prodDb.rows[0].nombre, mesaDb.rows[0].numero_mesa]
        );
        res.json({ success: true }); 
        io.emit('actualizar_mesas'); 
        io.emit('campana_cocina'); 
    } catch (e) { next(e); } 
});

app.delete('/api/pedidos/eliminar/:id', verificarSesion, async (req, res, next) => { 
    try { 
        const id = z.coerce.number().int().parse(req.params.id); 
        const p = await pool.query('SELECT producto_id, cantidad FROM pedidos_mesa WHERE id = $1', [id]); 
        if (p.rows.length > 0) { 
            await pool.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [p.rows[0].cantidad, p.rows[0].producto_id]); 
            await pool.query('DELETE FROM pedidos_mesa WHERE id = $1', [id]); 
        } 
        res.json({ success: true }); 
        io.emit('actualizar_mesas'); 
        io.emit('actualizar_cocina'); 
    } catch (e) { next(e); } 
});

// ==========================================
// 10. RUTAS API: ADMINISTRACIÓN Y REPORTES
// ==========================================
app.post('/api/gastos/nuevo', verificarSesion, async (req, res, next) => { 
    try { 
        const val = gastoSchema.parse(req.body); 
        await pool.query('INSERT INTO gastos (descripcion, monto) VALUES ($1, $2)', [val.descripcion, val.monto]); 
        res.json({ success: true }); 
        io.emit('actualizar_caja'); 
    } catch (e) { next(e); } 
});

// ==========================================
// 10.6. RUTAS API: CRM Y FIDELIZACIÓN (CLUB LA ESQUINA)
// ==========================================


// ==========================================
// INTEGRACIÓN LECTURA Y CANJE SEGURO
// ==========================================


// ==========================================
// 10.7. RUTAS API: GESTOR DE BENEFICIOS (CMS)
// ==========================================

/* ============================================================
   API AUDITORÍA FORENSE (ISO 27001)
   ============================================================ */


app.get('/api/caja/actual', verificarSesion, async (req, res, next) => {
    try { 
        // 🛡️ SUB-CONSULTA PURA: Evitamos que Node.js desajuste las zonas horarias
        const filtroCierre = "(SELECT COALESCE(MAX(fecha_cierre), '2000-01-01 00:00:00') FROM cierres)"; 
        
        const queries = [ 
            pool.query(`SELECT COALESCE(SUM(total_final), 0) as t FROM ventas WHERE fecha > ${filtroCierre}`), 
            pool.query(`SELECT COALESCE(SUM(monto), 0) as t FROM gastos WHERE fecha > ${filtroCierre}`), 
            pool.query(`SELECT COALESCE(SUM(total_productos), 0) as t FROM ventas WHERE fecha > ${filtroCierre}`), 
            pool.query(`SELECT COALESCE(SUM(total_tiempo), 0) as t FROM ventas WHERE fecha > ${filtroCierre}`), 
            pool.query(`SELECT COALESCE(SUM(CASE WHEN metodo_pago = 'EFECTIVO' THEN total_final WHEN metodo_pago = 'MIXTO' THEN pago_efectivo ELSE 0 END), 0) as t FROM ventas WHERE fecha > ${filtroCierre}`), 
            pool.query(`SELECT COALESCE(SUM(CASE WHEN metodo_pago IN ('YAPE', 'PLIN', 'TARJETA') THEN total_final WHEN metodo_pago = 'MIXTO' THEN pago_digital ELSE 0 END), 0) as t FROM ventas WHERE fecha > ${filtroCierre}`), 
            pool.query(`SELECT *, TO_CHAR(fecha, 'HH24:MI') as hora FROM ventas WHERE fecha > ${filtroCierre} ORDER BY fecha DESC`) 
        ]; 
        
        const results = await Promise.all(queries); 
        const totalVentas = parseFloat(results[0].rows[0].t || 0); 
        const totalGastos = parseFloat(results[1].rows[0].t || 0); 
        const totalEfectivo = parseFloat(results[4].rows[0].t || 0); 
        const totalDigital = parseFloat(results[5].rows[0].t || 0); 
        
        res.json({ total_ventas: totalVentas, total_gastos: totalGastos, total_caja_real: totalVentas - totalGastos, dinero_en_cajon: totalEfectivo - totalGastos, desglose: { efectivo: totalEfectivo, digital: totalDigital }, total_productos: parseFloat(results[2].rows[0].t || 0), total_mesas: parseFloat(results[3].rows[0].t || 0), lista: results[6].rows }); 
    } catch (e) { next(e); }
});

app.post('/api/caja/cerrar', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        // 🛡️ La misma sub-consulta nativa para el cierre definitivo
        const filtroCierre = "(SELECT COALESCE(MAX(fecha_cierre), '2000-01-01 00:00:00') FROM cierres)"; 
        
        const v = await pool.query(`SELECT COALESCE(SUM(total_final), 0) as total, COUNT(*) as cantidad FROM ventas WHERE fecha > ${filtroCierre}`); 
        const g = await pool.query(`SELECT COALESCE(SUM(monto), 0) as total FROM gastos WHERE fecha > ${filtroCierre}`); 
        
        const totalVentas = parseFloat(v.rows[0].total || 0);
        const totalGastos = parseFloat(g.rows[0].total || 0);
        const cantidadMesas = parseInt(v.rows[0].cantidad || 0);
        const gananciaNeta = totalVentas - totalGastos;

        // 1. Guardar en Base de Datos
        await pool.query('INSERT INTO cierres (total_ventas, total_gastos, cantidad_mesas, fecha_cierre) VALUES ($1, $2, $3, NOW())', [totalVentas, totalGastos, cantidadMesas]); 
        
        // 2. DISPARADOR AUTOMÁTICO HACIA n8n
        try {
            const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://tu-servidor-n8n.com/webhook/cierre-caja';
            fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    evento: 'CIERRE_CAJA_BILLAR',
                    local: 'La Esquina del Billar',
                    fecha: new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }),
                    ventas_totales: totalVentas,
                    gastos_totales: totalGastos,
                    ganancia_neta: gananciaNeta,
                    mesas_atendidas: cantidadMesas
                })
            }).catch(err => console.log("Aviso webhook:", err.message));
        } catch (error) { console.log("Error webhook:", error); }

        // 3. Responder al cajero instantáneamente
        res.json({ success: true, total: totalVentas, gastos: totalGastos }); 
    } catch (e) { next(e); } 
});
app.delete('/api/ventas/eliminar/:id', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const id = z.coerce.number().int().parse(req.params.id)
        const ventaDb = await pool.query('SELECT total_final FROM ventas WHERE id = $1', [id]);
        if(ventaDb.rows.length > 0) {
            await pool.query(
                "INSERT INTO auditoria (usuario_id, accion, detalles) VALUES ($1, 'ELIMINAR VENTA', 'Borró del sistema una venta de S/ ' || $2)", 
                [req.usuario.id, ventaDb.rows[0].total_final]
            );
        } 
        await pool.query('DELETE FROM ventas WHERE id = $1', [id]); 
        res.json({ success: true }); io.emit('actualizar_caja'); 
    } catch (e) { next(e); } 
});


app.post('/api/productos/agregar-stock', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const val = stockSchema.parse(req.body); 
        await pool.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [val.cantidad, val.id]); 
        if (val.costo && val.costo > 0) { 
            await pool.query('INSERT INTO gastos (descripcion, monto) VALUES ($1, $2)', [`Compra Inv: ${val.nombre} (+${val.cantidad})`, val.costo]); 
            io.emit('actualizar_caja'); 
        } 
        res.json({success:true}); 
    } catch(e){ next(e); } 
});

app.get('/api/config', verificarSesion, async (req, res, next) => { 
    try { const r = await pool.query("SELECT * FROM config"); res.json(r.rows); } catch (e) { next(e); } 
});

app.post('/api/config', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const p = z.coerce.number().positive().parse(req.body.precio_billar); 
        await pool.query("UPDATE config SET valor = $1 WHERE clave = 'precio_billar'", [p]); 
        configCache.ultimaActualizacion = 0; res.json({ success: true }); 
    } catch (e) { next(e); } 
});

app.get('/api/estadisticas/semana', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const v = await pool.query(`SELECT TO_CHAR(fecha, 'DD/MM') as dia, SUM(total_final) as total FROM ventas WHERE fecha > NOW() - INTERVAL '7 days' GROUP BY dia ORDER BY MIN(fecha) ASC`); 
        const p = await pool.query(`SELECT p.nombre, SUM(pm.cantidad) as cantidad FROM pedidos_mesa pm JOIN productos p ON pm.producto_id = p.id GROUP BY p.nombre ORDER BY cantidad DESC LIMIT 5`); 
        res.json({ ventas: v.rows, top_productos: p.rows }); 
    } catch (e) { next(e); } 
});

app.delete('/api/reportes/eliminar/:id', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const id = z.coerce.number().int().parse(req.params.id); 
        const t = await pool.query('SELECT fecha_cierre FROM cierres WHERE id = $1', [id]); 
        if (t.rows.length === 0) return res.status(404).json({ error: 'Reporte no encontrado' }); 
        const f = t.rows[0].fecha_cierre; 
        const p = await pool.query('SELECT MAX(fecha_cierre) as fecha FROM cierres WHERE fecha_cierre < $1', [f]); 
        const fa = p.rows[0].fecha || '2000-01-01'; 
        await pool.query('DELETE FROM ventas WHERE fecha > $1 AND fecha <= $2', [fa, f]); 
        await pool.query('DELETE FROM cierres WHERE id = $1', [id]); 
        res.json({ success: true }); io.emit('actualizar_caja'); 
    } catch (e) { next(e); } 
});

app.get('/api/reportes/historial', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { const r = await pool.query('SELECT * FROM cierres ORDER BY fecha_cierre DESC LIMIT 30'); res.json(r.rows); } catch (e) { next(e); } 
});

// ==========================================
// 10.5. RUTAS API: GESTIÓN DE EMPLEADOS
// ==========================================


// ==========================================
// 11. GESTOR CENTRAL DE ERRORES
// ==========================================
app.use((err, req, res, next) => {
    console.error("🔥 Error del Servidor:", err.message || err);
    if (err instanceof z.ZodError) { 
        return res.status(400).json({ error: "Datos inválidos.", detalles: err.errors.map(e => `${e.path.join('.')}: ${e.message}`) }); 
    }
    if (err.code) { 
        return res.status(500).json({ error: "Ocurrió un error en la base de datos." }); 
    }
    res.status(500).json({ error: "Ocurrió un error interno en el servidor." });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎱 Servidor "La Esquina" ejecutándose en el puerto ${PORT}`));

// ==========================================
// 13. MÓDULO DE BUSINESS INTELLIGENCE (BI)
// ==========================================

app.get('/api/analytics/dashboard', verificarSesion, soloAdmin, async (req, res, next) => {
    try {
        const { inicio, fin } = req.query;
        let filtroVentas = "";
        let filtroPedidos = "";
        let params = [];

        // Si el cliente envía fechas, activamos el filtro temporal
        if (inicio && fin) {
            // Se le suma 1 día al final para que incluya las ventas hasta las 23:59:59 de ese día
            filtroVentas = "AND v.fecha >= $1::date AND v.fecha < ($2::date + interval '1 day')";
            filtroPedidos = "AND pm.fecha_creacion >= $1::date AND pm.fecha_creacion < ($2::date + interval '1 day')";
            params = [inicio, fin];
        }

        // 1. KPI: Productos más vendidos (Top 5)
        const topProductos = await pool.query(`
            SELECT p.nombre, SUM(pm.cantidad) as total_vendido 
            FROM pedidos_mesa pm 
            JOIN productos p ON pm.producto_id = p.id 
            WHERE pm.pagado = TRUE ${filtroPedidos}
            GROUP BY p.nombre 
            ORDER BY total_vendido DESC LIMIT 5
        `, params);

        // 2. KPI: Ingresos por Método de Pago
        // (Reemplazamos v.fecha por fecha ya que en esta tabla no usamos alias 'v')
        let filtroVentasDirecto = filtroVentas.replace(/v\.fecha/g, 'fecha');
        const ingresosMetodo = await pool.query(`
            SELECT metodo_pago, COUNT(id) as transacciones, SUM(total_final) as monto 
            FROM ventas 
            WHERE metodo_pago IS NOT NULL ${filtroVentasDirecto}
            GROUP BY metodo_pago
        `, params);

        // 3. KPI: Rendimiento de las Mesas de Billar
        const rendimientoMesas = await pool.query(`
            SELECT m.numero_mesa, COUNT(v.id) as usos, SUM(v.total_tiempo) as recaudacion 
            FROM ventas v
            JOIN mesas m ON v.mesa_id = m.id
            WHERE v.total_tiempo > 0 ${filtroVentas}
            GROUP BY m.numero_mesa 
            ORDER BY recaudacion DESC LIMIT 5
        `, params);

        res.json({
            productos: topProductos.rows,
            metodos: ingresosMetodo.rows,
            mesas: rendimientoMesas.rows
        });
    } catch (e) { 
        console.error("Error en motor BI:", e);
        res.status(500).json({ error: "Error procesando analíticas", sql_error: e.message }); 
    }
});