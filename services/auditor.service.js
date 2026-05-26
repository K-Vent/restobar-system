// /services/auditor.service.js
const pool = require('../db.js');

/**
 * Servicio Central de Auditoría
 * Registra acciones sin detener el flujo principal del servidor.
 */
const registrarAuditoria = async (req, accion, detalles) => {
    try {
        // Extraemos el ID del usuario si existe en la sesión
        const usuario_id = req.usuario ? req.usuario.id : null;
        
        await pool.query(
            "INSERT INTO auditoria (usuario_id, accion, detalles) VALUES ($1, $2, $3)", 
            [usuario_id, accion, detalles]
        );
    } catch (error) {
        // Falla en silencio para no arruinar la venta o el cierre
        console.error(` [Auditoría Falló] Acción: ${accion} - Error:`, error.message);
    }
};

module.exports = { registrarAuditoria };