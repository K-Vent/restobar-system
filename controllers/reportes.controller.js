const pool = require('../db.js');

const getDashboardStats = async (req, res) => {
    try {
        const { inicio, fin } = req.query;
        let dateFilter = "";
        let params = [];

        // Si el usuario aplicó filtro de fechas desde el frontend
        if (inicio && fin) {
            dateFilter = "WHERE fecha >= $1 AND fecha <= $2";
            // Le sumamos '23:59:59' al fin para que incluya todas las ventas de ese último día
            params = [inicio, fin + ' 23:59:59'];
        }

        // 1. Rendimiento por Mesa (Cuáles generan más dinero)
        const mesas = await pool.query(`
            SELECT m.numero_mesa, COALESCE(SUM(v.total_final), 0) as recaudacion
            FROM ventas v
            JOIN mesas m ON v.mesa_id = m.id
            ${dateFilter}
            GROUP BY m.numero_mesa
            ORDER BY recaudacion DESC
        `, params);

        // 2. Top Productos (Los 5 más vendidos, históricamente o por turno)
        const productos = await pool.query(`
            SELECT p.nombre, SUM(pm.cantidad) as total_vendido 
            FROM pedidos_mesa pm 
            JOIN productos p ON pm.producto_id = p.id 
            WHERE pm.pagado = TRUE
            GROUP BY p.nombre 
            ORDER BY total_vendido DESC LIMIT 5
        `);

        // 3. Flujo de Caja (Efectivo vs Digital/Mixto)
        const metodos = await pool.query(`
            SELECT metodo_pago, COALESCE(SUM(total_final), 0) as monto
            FROM ventas
            ${dateFilter}
            GROUP BY metodo_pago
        `, params);

        // Retornamos la estructura exacta que espera Chart.js en tu frontend
        res.json({
            mesas: mesas.rows,
            productos: productos.rows,
            metodos: metodos.rows
        });

    } catch (error) {
        console.error("⚠️ Error en Motor Analytics:", error);
        res.status(500).json({ error: "Fallo en el procesamiento de BI" });
    }
};

const getHistorialCierres = async (req, res) => {
    try {
        // Traemos los últimos 50 cierres de caja ordenados por el más reciente
        const historial = await pool.query('SELECT * FROM cierres ORDER BY fecha_cierre DESC LIMIT 50');
        res.json(historial.rows);
    } catch (error) {
        console.error("⚠️ Error leyendo historial de cierres:", error);
        res.json([]); // Enviamos un array vacío para no romper la tabla visual
    }
};

const eliminarCierre = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM cierre_caja WHERE id = $1', [id]);
        
        // 🔒 Espía Auditoría: Registramos quién y cuándo anuló un cierre
        try {
            await pool.query(
                "INSERT INTO auditoria (usuario_id, accion, detalles) VALUES ($1, 'ANULACIÓN', 'Anuló el cierre de caja ID: ' || $2)", 
                [req.usuario.id, id]
            );
        } catch (eEspia) {}

        res.json({ success: true });
    } catch (error) {
        console.error("⚠️ Error al eliminar cierre:", error);
        res.status(500).json({ error: "Error en servidor al anular" });
    }
};

module.exports = { getDashboardStats, getHistorialCierres, eliminarCierre };