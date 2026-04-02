const pool = require('../db.js'); 
const bcrypt = require('bcrypt');

const obtenerUsuarios = async (req, res, next) => { 
    try { 
        // Solo trae a los activos
        const r = await pool.query("SELECT id, username, rol FROM usuarios WHERE estado = 'activo' ORDER BY id ASC"); 
        res.json(r.rows); 
    } catch (e) { next(e); } 
};

const crearUsuario = async (req, res, next) => { 
    try { 
        const { username, password, rol } = req.body; 
        const existe = await pool.query("SELECT id FROM usuarios WHERE username = $1 AND estado = 'activo'", [username]);
        if (existe.rows.length > 0) return res.status(400).json({ error: 'El nombre de usuario ya está en uso' });

        const hash = await bcrypt.hash(password, 10); 
        await pool.query("INSERT INTO usuarios (username, password, rol, estado) VALUES ($1, $2, $3, 'activo')", [username, hash, rol]); 
        res.json({ success: true }); 
    } catch (e) { next(e); } 
};

const eliminarUsuario = async (req, res, next) => { 
    try { 
        const id = parseInt(req.params.id); 
        if (id === req.usuario.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
        
        // El Soft Delete: Solo lo ocultamos
        await pool.query("UPDATE usuarios SET estado = 'inactivo' WHERE id = $1", [id]); 
        res.json({ success: true, message: 'Usuario desactivado correctamente' }); 
    } catch (e) { next(e); } 
};

module.exports = { obtenerUsuarios, crearUsuario, eliminarUsuario };