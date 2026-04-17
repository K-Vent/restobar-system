const pool = require('../db.js');

// ==========================================
// CONTROLADORES VIP Y FIDELIZACIÓN
// ==========================================

const obtenerClientes = async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM clientes ORDER BY sellos DESC, fecha_registro DESC');
        res.json(result.rows);
    } catch (e) { next(e); }
};

const registrarCliente = async (req, res, next) => {
    try {
        console.log("📥 RECIBIENDO DATOS DEL SOCIO:", req.body); 

        const { nombre, telefono, pin } = req.body; 
        
        if (!nombre) return res.status(400).json({ error: "El nombre es obligatorio" });
        
        if (!pin || pin.trim() === "") {
            return res.status(400).json({ error: "⚠️ ALERTA: El PIN no está llegando al servidor desde la página web." });
        }

        if (telefono) {
            const existe = await pool.query('SELECT id FROM clientes WHERE telefono = $1', [telefono]);
            if (existe.rows.length > 0) return res.status(400).json({ error: "Este teléfono ya está registrado" });
        }

        await pool.query('INSERT INTO clientes (nombre, telefono, pin) VALUES ($1, $2, $3)', [nombre, telefono, pin]);
        res.json({ success: true });
    } catch (e) { next(e); }
};

const loginVip = async (req, res, next) => {
    try {
        const { telefono, pin } = req.body;
        const result = await pool.query('SELECT id, nombre, sellos, nivel, premios_canjeados FROM clientes WHERE telefono = $1 AND pin = $2', [telefono, pin]);
        
        if (result.rows.length === 0) return res.status(401).json({ error: "Teléfono o PIN incorrectos." });
        
        res.json(result.rows[0]);
    } catch (e) { next(e); }
};

const agregarSello = async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        await pool.query('UPDATE clientes SET sellos = sellos + 1 WHERE id = $1', [id]);
        
        const cliente = await pool.query('SELECT sellos FROM clientes WHERE id = $1', [id]);
        const totalSellos = cliente.rows[0].sellos;
        
        let nuevoNivel = 'Bronce';
        if (totalSellos >= 10) nuevoNivel = 'Plata';
        if (totalSellos >= 20) nuevoNivel = 'Oro 👑';

        await pool.query('UPDATE clientes SET nivel = $1 WHERE id = $2', [nuevoNivel, id]);

        res.json({ success: true, sellos_actuales: totalSellos, nivel: nuevoNivel });
    } catch (e) { next(e); }
};

const canjearPremio = async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const result = await pool.query('SELECT sellos, premios_canjeados FROM clientes WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Socio no encontrado" });
        
        const c = result.rows[0];
        const canjeados = c.premios_canjeados || 0;
        const premiosDisponibles = Math.floor(c.sellos / 10) - canjeados;

        if (premiosDisponibles > 0) {
            await pool.query('UPDATE clientes SET premios_canjeados = COALESCE(premios_canjeados, 0) + 1 WHERE id = $1', [id]);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: "Este socio no tiene recompensas pendientes de cobro." });
        }
    } catch (e) { next(e); }
};

const escanearQr = async (req, res, next) => {
    try {
        const codigo = req.params.codigo; 
        if (!codigo.startsWith('socio-')) return res.status(400).json({ error: "QR no válido para este sistema." });
        
        const idSocio = parseInt(codigo.split('-')[1]);
        const result = await pool.query('SELECT id, nombre, sellos, nivel, premios_canjeados FROM clientes WHERE id = $1', [idSocio]);
        
        if (result.rows.length === 0) return res.status(404).json({ error: "Socio no encontrado." });
        
        const c = result.rows[0];
        const canjeados = c.premios_canjeados || 0;
        const premiosDisponibles = Math.floor(c.sellos / 10) - canjeados;
        
        res.json({ id: c.id, nombre: c.nombre, nivel: c.nivel, premios: premiosDisponibles });
    } catch (e) { next(e); }
};

const canjeSeguroTransaccion = async (req, res, next) => {
    const cliente = await pool.connect(); 
    try {
        const { idSocio, idMesa } = req.body;
        await cliente.query('BEGIN'); 

        const resSocio = await cliente.query('SELECT sellos, premios_canjeados FROM clientes WHERE id = $1', [idSocio]);
        const premiosDisponibles = Math.floor(resSocio.rows[0].sellos / 10) - (resSocio.rows[0].premios_canjeados || 0);
        
        if (premiosDisponibles <= 0) throw new Error("El socio no tiene premios disponibles.");

        await cliente.query('UPDATE clientes SET premios_canjeados = COALESCE(premios_canjeados, 0) + 1 WHERE id = $1', [idSocio]);
        await cliente.query("UPDATE mesas SET hora_inicio = hora_inicio + INTERVAL '1 hour' WHERE id = $1", [idMesa]);
        await cliente.query("INSERT INTO auditoria (usuario_id, accion, detalles) VALUES ($1, 'CANJE VIP', 'Socio ID ' || $2 || ' usó 1 hora gratis en Mesa ' || $3)", [req.usuario.id, idSocio, idMesa]);

        await cliente.query('COMMIT'); 
        res.json({ success: true });
    } catch (e) { 
        await cliente.query('ROLLBACK'); 
        res.status(400).json({ error: e.message || "Error en la transacción" });
    } finally {
        cliente.release();
    }
};

// ==========================================
// CONTROLADORES DE BENEFICIOS (CMS)
// ==========================================
const obtenerBeneficios = async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM beneficios ORDER BY id ASC');
        res.json(result.rows);
    } catch (e) { next(e); }
};

const agregarBeneficio = async (req, res, next) => {
    try {
        const { nivel, descripcion } = req.body;
        if (!nivel || !descripcion) return res.status(400).json({ error: "Faltan datos" });
        
        await pool.query('INSERT INTO beneficios (nivel, descripcion) VALUES ($1, $2)', [nivel, descripcion]);
        res.json({ success: true });
    } catch (e) { next(e); }
};

const eliminarBeneficio = async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        await pool.query('DELETE FROM beneficios WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (e) { next(e); }
};
const eliminarCliente = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Usamos tu conexión 'pool' directamente y sin rodeos
        await pool.query('DELETE FROM clientes WHERE id = $1', [id]);
        
        res.status(200).json({ message: 'Socio VIP eliminado correctamente' });
        
    } catch (error) {
        console.error("🔥 ERROR CRÍTICO AL BORRAR CLIENTE:", error.message);
        
        // Candado de seguridad: Si el cliente tiene canjes, no se borra para no dañar la contabilidad
        if (error.code === '23503') {
            return res.status(500).json({ 
                error: 'Seguridad: No puedes borrar a este cliente porque tiene historial de canjes o compras.' 
            });
        }

        res.status(500).json({ error: 'Error en la base de datos al intentar eliminar.' });
    }
};
// Recuerda exportarlo al final: module.exports = { ... , eliminarCliente };
module.exports = { 
    obtenerClientes, registrarCliente, loginVip, agregarSello, 
    canjearPremio, escanearQr, canjeSeguroTransaccion, 
    obtenerBeneficios, agregarBeneficio, eliminarBeneficio, eliminarCliente
};