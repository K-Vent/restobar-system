// Ojo: asegúrate de usar la variable correcta para tu base de datos (pool)
const pool = require('../db.js'); 

const obtenerRegistrosAuditoria = async (req, res, next) => {
    try {
        // Unimos la tabla de auditoría con la de usuarios para saber el NOMBRE del empleado
        // Mostramos los últimos 200 eventos ordenados del más reciente al más antiguo
        const consulta = `
            SELECT 
                a.id, 
                a.fecha, 
                a.accion, 
                a.detalles, 
                COALESCE(u.nombre, 'Admin/Desconocido') AS usuario 
            FROM auditoria a
            LEFT JOIN usuarios u ON a.usuario_id = u.id
            ORDER BY a.fecha DESC
            LIMIT 200
        `;
        
        const result = await pool.query(consulta);
        res.json(result.rows);
    } catch (error) {
        console.error("🔥 Error al leer auditoría:", error);
        res.status(500).json({ error: 'Error al obtener registros de auditoría' });
    }
};

module.exports = {
    obtenerRegistrosAuditoria
};