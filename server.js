const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors'); 
const session = require('express-session'); // [NUEVO] Librería de sesiones
const app = express(); 

// CONEXIÓN A BASE DE DATOS
const pool = new Pool({
    connectionString: 'postgresql://postgres.iqrhtvwddlqlrenfsaxa:Laesquinadelbillar@aws-1-sa-east-1.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false } 
});

// CONFIGURACIÓN DE SEGURIDAD (SESIONES)
app.use(session({
    secret: 'secreto_super_seguro_billar_123', // Llave para firmar las cookies
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // La sesión dura 24 horas
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. Archivos Públicos (Login, Logo, CSS)
app.use(express.static(path.join(__dirname, 'public')));

// 2. EL PORTERO (Middleware de Seguridad)
// Esta función revisa si tienes permiso antes de dejarte pasar
const verificarSesion = (req, res, next) => {
    if (req.session.usuario) {
        next(); // Tiene pase, adelante.
    } else {
        res.redirect('/'); // No tiene pase, fuera (al login).
    }
};

// --- RUTAS PROTEGIDAS (Solo accesibles con sesión) ---
// Ahora servimos los archivos HTML desde la carpeta 'private' usando el portero

app.get('/dashboard.html', verificarSesion, (req, res) => {
    res.sendFile(path.join(__dirname, 'private', 'dashboard.html'));
});

app.get('/inventario.html', verificarSesion, (req, res) => {
    res.sendFile(path.join(__dirname, 'private', 'inventario.html'));
});

app.get('/reportes.html', verificarSesion, (req, res) => {
    res.sendFile(path.join(__dirname, 'private', 'reportes.html'));
});

app.get('/cierre_caja.html', verificarSesion, (req, res) => {
    res.sendFile(path.join(__dirname, 'private', 'cierre_caja.html'));
});

// --- RUTA DE LOGIN (Damos el pase VIP) ---
app.post(['/login', '/api/login'], async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM usuarios WHERE username = $1 AND password = $2', [username, password]);
        
        if (result.rows.length > 0) {
            // [CLAVE] Guardamos al usuario en la sesión
            req.session.usuario = result.rows[0]; 
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- RUTA DE LOGOUT (Quitamos el pase) ---
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// --- [AQUÍ SIGUEN TUS API DE SIEMPRE] ---
// Copia aquí abajo todo el resto de tu código de API (mesas, productos, caja, etc.)
// ... (El código de API es el mismo que tenías antes, pégalo aquí)
// ----------------------------------------

// --- API MESAS Y PRODUCTOS ---
app.get('/api/mesas', verificarSesion, async (req, res) => { // Nota: También protegemos los datos
    try {
        const result = await pool.query('SELECT * FROM mesas ORDER BY numero_mesa ASC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/productos', verificarSesion, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM productos ORDER BY nombre ASC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// [PEGA AQUÍ EL RESTO DE TUS RUTAS: /api/caja/actual, /api/pedidos/agregar, etc.]
// Te recomiendo usar 'verificarSesion' en todas las rutas '/api/...' para que nadie 
// pueda robarte datos usando Postman o herramientas externas.

// EJEMPLO RAPIDO DE CÓMO SE VE UNA RUTA PROTEGIDA:
app.get('/api/caja/actual', verificarSesion, async (req, res) => {
    // ... tu lógica de caja ...
    // (Usa el mismo código que tenías, solo añade 'verificarSesion' después de la ruta)
    try {
        const ultimoCierre = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres");
        const fechaInicio = ultimoCierre.rows[0].fecha;
        const result = await pool.query(`SELECT COALESCE(SUM(total_tiempo), 0) as total_tiempo, COALESCE(SUM(total_productos), 0) as total_productos, COALESCE(SUM(total_final), 0) as total_dia FROM ventas WHERE fecha > $1`, [fechaInicio]);
        const listaVentas = await pool.query(`SELECT mesa_id, tipo_mesa, total_final, total_tiempo, total_productos, TO_CHAR(fecha, 'HH24:MI') as hora FROM ventas WHERE fecha > $1 ORDER BY fecha DESC`, [fechaInicio]);
        res.json({ ...result.rows[0], lista: listaVentas.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ... (Continúa con todas las demás rutas pegadas igual que antes)

// --- MIGRACIÓN AUTOMÁTICA ---
(async () => {
    try {
        await pool.query("ALTER TABLE productos ADD COLUMN categoria VARCHAR(50) DEFAULT 'General'");
    } catch (e) { if (e.code !== '42701') console.log(e.message); }
})();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎱 Servidor Seguro funcionando en puerto ${PORT}`));