const pool = require('../db.js');

const obtenerProductos = async (req, res, next) => {
    try {
        // 🛡️ SOFT DELETE: Solo mostramos los productos que siguen activos
        const r = await pool.query("SELECT * FROM productos WHERE estado = 'activo' ORDER BY id ASC");
        res.json(r.rows);
    } catch (e) { 
        next(e); 
    }
};

const crearProducto = async (req, res, next) => {
    try {
        const { nombre, precio, stock, categoria } = req.body; 
        
        // Fíjate en la consulta SQL: insertamos en "precio_venta" el valor de "precio"
        await pool.query(
            "INSERT INTO productos (nombre, precio_venta, stock, categoria, estado) VALUES ($1, $2, $3,$4, 'activo')", 
            [nombre, precio, stock, categoria]
        );
        res.json({ success: true });
    } catch (e) { 
        next(e); 
    }
};

const eliminarProducto = async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        
        // 🛡️ SOFT DELETE: En vez de destruirlo, lo "apagamos" para no dañar boletas antiguas
        await pool.query("UPDATE productos SET estado = 'inactivo' WHERE id = $1", [id]);
        res.json({ success: true, message: 'Producto retirado del inventario' });
    } catch (e) { 
        next(e); 
    }
};

module.exports = { obtenerProductos, crearProducto, eliminarProducto };