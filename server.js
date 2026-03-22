/* ============================================================
   SERVER.JS - SISTEMA GESTIÓN "LA ESQUINA DEL BILLAR"
   Arquitectura: Stateless (JWT) / Ultra-Rápido
   ============================================================ */

require('dotenv').config();
const express = require('express');
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

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: "⛔ Demasiados intentos." } });

// ==========================================
// 3. MIDDLEWARES DE SEGURIDAD (STATELESS JWT)
// ==========================================
const verificarSesion = (req, res, next) => { 
    const token = req.cookies.token; // Lee el token directamente (Sin ir a la BD)
    if (!token) { 
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autorizado.' }); 
        return res.redirect('/'); 
    } 
    try { 
        const decoded = jwt.verify(token, SECRET_KEY); 
        req.usuario = decoded; // Adjuntamos los datos descifrados a la petición
        next(); 
    } catch (e) { 
        res.clearCookie('token');
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesión expirada.' }); 
        res.redirect('/'); 
    } 
};

const soloAdmin = (req, res, next) => { 
    if (req.usuario && req.usuario.rol === 'admin') return next(); 
    res.status(403).json({ error: '⛔ Acceso Denegado. Permisos insuficientes.' }); 
};

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
app.get('/api/mesas', verificarSesion, async (req, res, next) => { 
    try { 
        const precio = await getPrecioBillar(); 
        const r = await pool.query(`SELECT *, EXTRACT(EPOCH FROM (NOW() - hora_inicio)) as segundos_transcurridos FROM mesas ORDER BY numero_mesa ASC`); 
        
        const mesas = r.rows.map(m => ({ 
            ...m, 
            precio_hora: precio, 
            segundos: (m.estado === 'OCUPADA' && m.tipo === 'BILLAR') ? parseFloat(m.segundos_transcurridos) : 0 
        })); 
        res.json(mesas); 
    } catch (e) { next(e); } 
});

app.post('/api/mesas/abrir/:id', verificarSesion, async (req, res, next) => { 
    try { 
        const id = z.coerce.number().int().parse(req.params.id); 
        const val = abrirMesaSchema.parse(req.body); 
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NOW(), tiempo_limite = $2 WHERE id = $3', ['OCUPADA', val.minutos, id]); 
        res.json({ success: true }); 
        io.emit('actualizar_mesas'); 
    } catch(e){ next(e); } 
});

app.get('/api/mesas/detalle/:id', verificarSesion, async (req, res, next) => { 
    try { 
        const id = z.coerce.number().int().parse(req.params.id); 
        const precioHora = await getPrecioBillar(); 
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
    } catch (e) { next(e); } 
});

app.post('/api/mesas/cerrar/:id', verificarSesion, async (req, res, next) => {
    try { 
        const id = z.coerce.number().int().parse(req.params.id); 
        const val = cerrarMesaSchema.parse(req.body); 
        const precioHora = await getPrecioBillar(); 
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
        
        const efectivo = val.metodo === 'MIXTO' ? (val.pago_efectivo || 0) : (val.metodo === 'EFECTIVO' ? totalF : 0);
        const digital = val.metodo === 'MIXTO' ? (val.pago_digital || 0) : (val.metodo !== 'EFECTIVO' && val.metodo !== 'MIXTO' ? totalF : 0);

        await pool.query('INSERT INTO ventas (mesa_id, tipo_mesa, total_tiempo, total_productos, total_final, fecha, metodo_pago, pago_efectivo, pago_digital) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)', [id, mesa.tipo, totalT, totalC, totalF, val.metodo, efectivo, digital]); 
        await pool.query('UPDATE pedidos_mesa SET pagado = TRUE WHERE mesa_id = $1', [id]); 
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NULL, tiempo_limite = 0 WHERE id = $2', ['LIBRE', id]); 
        
        res.json({ success: true }); 
        io.emit('actualizar_mesas'); 
        io.emit('actualizar_caja'); 
    } catch (err) { next(err); }
});

app.post('/api/mesas/cambiar', verificarSesion, async (req, res, next) => { 
    try { 
        const val = cambiarMesaSchema.parse(req.body); 
        const origen = await pool.query('SELECT * FROM mesas WHERE id = $1', [val.idOrigen]); 
        const destino = await pool.query('SELECT * FROM mesas WHERE id = $1', [val.idDestino]); 
        if(origen.rows[0].estado !== 'OCUPADA') return res.status(400).json({error: 'Mesa origen no ocupada'}); 
        if(destino.rows[0].estado !== 'LIBRE') return res.status(400).json({error: 'Mesa destino ocupada'}); 
        
        const horaInicio = origen.rows[0].hora_inicio; 
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = $2 WHERE id = $3', ['OCUPADA', horaInicio, val.idDestino]); 
        await pool.query('UPDATE pedidos_mesa SET mesa_id = $1 WHERE mesa_id = $2', [val.idDestino, val.idOrigen]); 
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NULL WHERE id = $2', ['LIBRE', val.idOrigen]); 
        res.json({ success: true }); 
        io.emit('actualizar_mesas'); 
    } catch (e) { next(e); } 
});

// ==========================================
// 9. RUTAS API: PEDIDOS
// ==========================================
app.post('/api/pedidos/agregar', verificarSesion, async (req, res, next) => { 
    try { 
        const val = pedidoSchema.parse(req.body); 
        await pool.query('INSERT INTO pedidos_mesa (mesa_id, producto_id, cantidad, fecha_creacion, entregado) VALUES ($1, $2, $3, NOW(), FALSE)', [val.mesa_id, val.producto_id, val.cantidad]); 
        await pool.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [val.cantidad, val.producto_id]); 
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

// Obtener todos los clientes
app.get('/api/clientes', verificarSesion, async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM clientes ORDER BY sellos DESC, fecha_registro DESC');
        res.json(result.rows);
    } catch (e) { next(e); }
});

// Registrar un nuevo cliente VIP
app.post('/api/clientes/nuevo', verificarSesion, async (req, res, next) => {
    try {
        // 1. EL RADAR: Esto imprimirá en la consola de tu servidor (Render/Terminal) qué está recibiendo
        console.log("📥 RECIBIENDO DATOS DEL SOCIO:", req.body); 

        const { nombre, telefono, pin } = req.body; 
        
        if (!nombre) return res.status(400).json({ error: "El nombre es obligatorio" });
        
        // 2. EL ESCUDO: Si el PIN llega vacío o no llega, el servidor se detiene aquí y te lanza el error
        if (!pin || pin.trim() === "") {
            return res.status(400).json({ error: "⚠️ ALERTA: El PIN no está llegando al servidor desde la página web." });
        }

        if (telefono) {
            const existe = await pool.query('SELECT id FROM clientes WHERE telefono = $1', [telefono]);
            if (existe.rows.length > 0) return res.status(400).json({ error: "Este teléfono ya está registrado" });
        }

        // 3. LA INSERCIÓN EXACTA: Ya no hay '1234' por defecto. Guarda lo que tú escribas.
        await pool.query('INSERT INTO clientes (nombre, telefono, pin) VALUES ($1, $2, $3)', [nombre, telefono, pin]);
        
        res.json({ success: true });
    } catch (e) { next(e); }
});
// Inicio de Sesión para Clientes VIP
app.post('/api/vip/login', async (req, res, next) => {
    try {
        const { telefono, pin } = req.body;
        
        // Buscamos al cliente por teléfono y PIN
        const result = await pool.query('SELECT id, nombre, sellos, nivel, premios_canjeados FROM clientes WHERE telefono = $1 AND pin = $2', [telefono, pin]);
        
        if (result.rows.length === 0) return res.status(401).json({ error: "Teléfono o PIN incorrectos." });
        
        res.json(result.rows[0]);
    } catch (e) { next(e); }
});
// Añadir un sello (Punto) al cliente
app.post('/api/clientes/:id/sello', verificarSesion, async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        
        // Sumamos 1 sello
        await pool.query('UPDATE clientes SET sellos = sellos + 1 WHERE id = $1', [id]);
        
        // Lógica de Niveles (Opcional, pero le da un toque premium)
        const cliente = await pool.query('SELECT sellos FROM clientes WHERE id = $1', [id]);
        const totalSellos = cliente.rows[0].sellos;
        
        let nuevoNivel = 'Bronce';
        if (totalSellos >= 10) nuevoNivel = 'Plata';
        if (totalSellos >= 20) nuevoNivel = 'Oro 👑';

        await pool.query('UPDATE clientes SET nivel = $1 WHERE id = $2', [nuevoNivel, id]);

        res.json({ success: true, sellos_actuales: totalSellos, nivel: nuevoNivel });
    } catch (e) { next(e); }
});

// Canjear un premio (1 hora de billar gratis)
app.post('/api/clientes/:id/canjear', verificarSesion, async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        
        // 1. Consultamos el estado exacto del cliente
        const result = await pool.query('SELECT sellos, premios_canjeados FROM clientes WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Socio no encontrado" });
        
        const c = result.rows[0];
        const canjeados = c.premios_canjeados || 0;
        
        // 2. Calculamos matemáticamente si tiene premios disponibles
        const premiosDisponibles = Math.floor(c.sellos / 10) - canjeados;

        if (premiosDisponibles > 0) {
            // 3. Si tiene, le sumamos 1 al contador de premios cobrados
            await pool.query('UPDATE clientes SET premios_canjeados = COALESCE(premios_canjeados, 0) + 1 WHERE id = $1', [id]);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: "Este socio no tiene recompensas pendientes de cobro." });
        }
    } catch (e) { next(e); }
});

// ==========================================
// INTEGRACIÓN LECTURA Y CANJE SEGURO
// ==========================================

// 1. Leer el QR del cliente y devolver sus datos a la caja
app.get('/api/vip/escanear/:codigo', verificarSesion, async (req, res, next) => {
    try {
        const codigo = req.params.codigo; // Ej: "socio-5"
        if (!codigo.startsWith('socio-')) return res.status(400).json({ error: "QR no válido para este sistema." });
        
        const idSocio = parseInt(codigo.split('-')[1]);
        const result = await pool.query('SELECT id, nombre, sellos, nivel, premios_canjeados FROM clientes WHERE id = $1', [idSocio]);
        
        if (result.rows.length === 0) return res.status(404).json({ error: "Socio no encontrado." });
        
        const c = result.rows[0];
        const canjeados = c.premios_canjeados || 0;
        const premiosDisponibles = Math.floor(c.sellos / 10) - canjeados;
        
        res.json({ id: c.id, nombre: c.nombre, nivel: c.nivel, premios: premiosDisponibles });
    } catch (e) { next(e); }
});

// 2. Transacción Atómica: Canjear premio Y descontar la hora en la mesa al mismo tiempo
app.post('/api/transaccion/canje-seguro', verificarSesion, async (req, res, next) => {
    const cliente = await pool.connect(); // Usamos un cliente dedicado para la transacción
    try {
        const { idSocio, idMesa } = req.body;
        
        await cliente.query('BEGIN'); // Iniciamos el blindaje de la base de datos

        // A. Verificamos que el socio realmente tenga el premio
        const resSocio = await cliente.query('SELECT sellos, premios_canjeados FROM clientes WHERE id = $1', [idSocio]);
        const premiosDisponibles = Math.floor(resSocio.rows[0].sellos / 10) - (resSocio.rows[0].premios_canjeados || 0);
        
        if (premiosDisponibles <= 0) throw new Error("El socio no tiene premios disponibles.");

        // B. Descontamos el premio de su cuenta VIP
        await cliente.query('UPDATE clientes SET premios_canjeados = COALESCE(premios_canjeados, 0) + 1 WHERE id = $1', [idSocio]);

        // C. Descontamos 60 minutos del tiempo de la mesa para cuadrar tu caja
        await cliente.query("UPDATE mesas SET hora_inicio = hora_inicio + INTERVAL '1 hour' WHERE id = $1", [idMesa]);

        // D. Dejamos registro en auditoría
        await cliente.query("INSERT INTO auditoria (usuario_id, accion, detalles) VALUES ($1, 'CANJE VIP AGORA', 'Socio ID ' || $2 || ' usó 1 hora gratis en Mesa ' || $3)", [req.usuario.id, idSocio, idMesa]);

        await cliente.query('COMMIT'); // Guardamos los 3 cambios de golpe
        res.json({ success: true });
    } catch (e) { 
        await cliente.query('ROLLBACK'); // Si algo falla, cancelamos todo para no descuadrar nada
        res.status(400).json({ error: e.message || "Error en la transacción" });
    } finally {
        cliente.release();
    }
});

// ==========================================
// 10.7. RUTAS API: GESTOR DE BENEFICIOS (CMS)
// ==========================================
// Obtener todos los beneficios (Público, para que el celular del cliente lo pueda leer)
app.get('/api/beneficios', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM beneficios ORDER BY id ASC');
        res.json(result.rows);
    } catch (e) { next(e); }
});

// Añadir un nuevo beneficio (Solo el Admin/Sistema)
app.post('/api/beneficios', verificarSesion, async (req, res, next) => {
    try {
        const { nivel, descripcion } = req.body;
        if (!nivel || !descripcion) return res.status(400).json({ error: "Faltan datos" });
        
        await pool.query('INSERT INTO beneficios (nivel, descripcion) VALUES ($1, $2)', [nivel, descripcion]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

// Eliminar un beneficio
app.delete('/api/beneficios/:id', verificarSesion, async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        await pool.query('DELETE FROM beneficios WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (e) { next(e); }
});
/* ============================================================
   API AUDITORÍA FORENSE (ISO 27001)
   ============================================================ */
app.get('/api/auditoria', verificarSesion, soloAdmin, async (req, res, next) => {
    try {
        // Traemos los últimos 100 movimientos sospechosos, ordenados por el más reciente
        const result = await pool.query(`
            SELECT 
                id, 
                nombre_tabla, 
                operacion, 
                registro_id, 
                datos_anteriores, 
                TO_CHAR(fecha_alteracion AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH12:MI:SS AM') as fecha_formateada 
            FROM auditoria_logs 
            ORDER BY fecha_alteracion DESC 
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (error) {
        next(error);
    }
});

app.get('/api/caja/actual', verificarSesion, async (req, res, next) => {
    try { 
        const u = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres"); const f = u.rows[0].fecha; 
        const queries = [ 
            pool.query(`SELECT COALESCE(SUM(total_final), 0) as t FROM ventas WHERE fecha > $1`, [f]), 
            pool.query(`SELECT COALESCE(SUM(monto), 0) as t FROM gastos WHERE fecha > $1`, [f]), 
            pool.query(`SELECT COALESCE(SUM(total_productos), 0) as t FROM ventas WHERE fecha > $1`, [f]), 
            pool.query(`SELECT COALESCE(SUM(total_tiempo), 0) as t FROM ventas WHERE fecha > $1`, [f]), 
            pool.query(`SELECT COALESCE(SUM(CASE WHEN metodo_pago = 'EFECTIVO' THEN total_final WHEN metodo_pago = 'MIXTO' THEN pago_efectivo ELSE 0 END), 0) as t FROM ventas WHERE fecha > $1`, [f]), 
            pool.query(`SELECT COALESCE(SUM(CASE WHEN metodo_pago IN ('YAPE', 'PLIN', 'TARJETA') THEN total_final WHEN metodo_pago = 'MIXTO' THEN pago_digital ELSE 0 END), 0) as t FROM ventas WHERE fecha > $1`, [f]), 
            pool.query(`SELECT id, tipo_mesa, total_final, metodo_pago, TO_CHAR(fecha, 'HH24:MI') as hora FROM ventas WHERE fecha > $1 ORDER BY fecha DESC`, [f]) 
        ]; 
        const results = await Promise.all(queries); 
        const totalVentas = parseFloat(results[0].rows[0].t || 0); const totalGastos = parseFloat(results[1].rows[0].t || 0); 
        const totalEfectivo = parseFloat(results[4].rows[0].t || 0); const totalDigital = parseFloat(results[5].rows[0].t || 0); 
        
        res.json({ total_ventas: totalVentas, total_gastos: totalGastos, total_caja_real: totalVentas - totalGastos, dinero_en_cajon: totalEfectivo - totalGastos, desglose: { efectivo: totalEfectivo, digital: totalDigital }, total_productos: parseFloat(results[2].rows[0].t || 0), total_mesas: parseFloat(results[3].rows[0].t || 0), lista: results[6].rows }); 
    } catch (e) { next(e); }
});

app.post('/api/caja/cerrar', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const u = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres"); 
        const f = u.rows[0].fecha; 
        
        const v = await pool.query(`SELECT COALESCE(SUM(total_final), 0) as total, COUNT(*) as cantidad FROM ventas WHERE fecha > $1`, [f]); 
        const g = await pool.query(`SELECT COALESCE(SUM(monto), 0) as total FROM gastos WHERE fecha > $1`, [f]); 
        
        const totalVentas = parseFloat(v.rows[0].total || 0);
        const totalGastos = parseFloat(g.rows[0].total || 0);
        const cantidadMesas = parseInt(v.rows[0].cantidad || 0);
        const gananciaNeta = totalVentas - totalGastos;

        // 1. Guardar en Base de Datos (Supabase)
        await pool.query('INSERT INTO cierres (total_ventas, total_gastos, cantidad_mesas, fecha_cierre) VALUES ($1, $2, $3, NOW())', [totalVentas, totalGastos, cantidadMesas]); 
        
        // 2. DISPARADOR AUTOMÁTICO HACIA n8n (Webhook) 🚀
        try {
            // Aquí pondrás la URL secreta que te dará n8n más adelante
            const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://tu-servidor-n8n.com/webhook/cierre-caja';
            
            // Usamos fetch sin "await" para que trabaje en segundo plano sin frenar el sistema
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
            }).catch(err => console.log("Aviso: El webhook no detiene el sistema, pero falló el envío:", err.message));
            
        } catch (error) {
            console.log("Error interno al intentar disparar webhook:", error);
        }

        // 3. Responder al cajero instantáneamente
        res.json({ success: true, total: totalVentas, gastos: totalGastos }); 
    } catch (e) { next(e); } 
});

app.delete('/api/ventas/eliminar/:id', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const id = z.coerce.number().int().parse(req.params.id); 
        await pool.query('DELETE FROM ventas WHERE id = $1', [id]); 
        res.json({ success: true }); io.emit('actualizar_caja'); 
    } catch (e) { next(e); } 
});

app.get('/api/productos', verificarSesion, async (req, res, next) => { 
    try { const r = await pool.query('SELECT * FROM productos ORDER BY nombre ASC'); res.json(r.rows); } catch (e) { next(e); } 
});

app.post('/api/productos/nuevo', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const val = nuevoProductoSchema.parse(req.body); 
        await pool.query('INSERT INTO productos (nombre, precio_venta, stock, categoria) VALUES ($1, $2, $3, $4)', [val.nombre, val.precio, val.stock, val.categoria]); res.json({success:true}); 
    } catch(e){ next(e); } 
});

app.delete('/api/productos/eliminar/:id', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const id = z.coerce.number().int().parse(req.params.id); 
        await pool.query('DELETE FROM pedidos_mesa WHERE producto_id = $1', [id]); 
        await pool.query('DELETE FROM productos WHERE id = $1', [id]); res.json({ success: true }); 
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
app.get('/api/usuarios', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        // No enviamos las contraseñas al frontend por seguridad
        const r = await pool.query('SELECT id, username, rol FROM usuarios ORDER BY id ASC'); 
        res.json(r.rows); 
    } catch (e) { next(e); } 
});

app.post('/api/usuarios/nuevo', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const { username, password, rol } = usuarioSchema.parse(req.body); 
        
        // 1. Verificar si el usuario ya existe
        const existe = await pool.query('SELECT id FROM usuarios WHERE username = $1', [username]);
        if (existe.rows.length > 0) return res.status(400).json({ error: 'El nombre de usuario ya está en uso' });

        // 2. Encriptar la contraseña (Bcrypt)
        const hash = await bcrypt.hash(password, 10); 
        
        // 3. Guardar en BD
        await pool.query('INSERT INTO usuarios (username, password, rol) VALUES ($1, $2, $3)', [username, hash, rol]); 
        res.json({ success: true }); 
    } catch (e) { next(e); } 
});

app.delete('/api/usuarios/eliminar/:id', verificarSesion, soloAdmin, async (req, res, next) => { 
    try { 
        const id = z.coerce.number().int().parse(req.params.id); 
        
        // Evitar que el administrador se borre a sí mismo por accidente
        if (id === req.usuario.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta actual' });
        
        await pool.query('DELETE FROM usuarios WHERE id = $1', [id]); 
        res.json({ success: true }); 
    } catch (e) { next(e); } 
});


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

app.get('/api/analytics/dashboard', verificarSesion, async (req, res, next) => {
    try {
        // 1. KPI: Productos más vendidos (Top 5)
        const topProductos = await pool.query(`
            SELECT p.nombre, SUM(pd.cantidad) as total_vendido 
            FROM pedidos pd 
            JOIN productos p ON pd.producto_id = p.id 
            GROUP BY p.id, p.nombre 
            ORDER BY total_vendido DESC LIMIT 5
        `);

        // 2. KPI: Ingresos por Método de Pago
        const ingresosMetodo = await pool.query(`
            SELECT metodo_pago, COUNT(id) as transacciones, SUM(total) as monto 
            FROM caja_historial 
            WHERE metodo_pago IS NOT NULL
            GROUP BY metodo_pago
        `);

        // 3. KPI: Rendimiento de las Mesas de Billar (Cuáles facturan más)
        const rendimientoMesas = await pool.query(`
            SELECT numero_mesa, COUNT(id) as usos, SUM(total) as recaudacion 
            FROM mesas 
            WHERE estado = 'LIBRE' AND total > 0
            GROUP BY numero_mesa 
            ORDER BY recaudacion DESC LIMIT 5
        `);

        res.json({
            productos: topProductos.rows,
            metodos: ingresosMetodo.rows,
            mesas: rendimientoMesas.rows
        });
    } catch (e) { 
        // Si las tablas varían un poco en tu BD, enviamos datos de prueba seguros para que el gráfico no se rompa
        res.json({ error: "Datos en construcción", sql_error: e.message }); 
    }
});