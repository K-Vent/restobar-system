// ... (Tus configuraciones previas siguen igual) ...

// --- NUEVA LÓGICA DE CAJA (MODIFICADA) ---
app.get('/api/caja/actual', async (req, res) => {
    try {
        // 1. Buscamos fecha del último cierre
        const ultimoCierre = await pool.query("SELECT COALESCE(MAX(fecha_cierre), '2000-01-01') as fecha FROM cierres");
        const fechaInicio = ultimoCierre.rows[0].fecha;

        // 2. Calculamos totales
        const result = await pool.query(`
            SELECT COALESCE(SUM(total_tiempo), 0) as total_tiempo, 
                   COALESCE(SUM(total_productos), 0) as total_productos, 
                   COALESCE(SUM(total_final), 0) as total_dia 
            FROM ventas 
            WHERE fecha > $1
        `, [fechaInicio]);
        
        // 3. (NUEVO) Obtenemos la lista de mesas cerradas en este turno
        const listaVentas = await pool.query(`
            SELECT mesa_id, tipo_mesa, total_final, total_tiempo, total_productos, TO_CHAR(fecha, 'HH24:MI') as hora
            FROM ventas
            WHERE fecha > $1
            ORDER BY fecha DESC
        `, [fechaInicio]);

        // Enviamos todo junto
        res.json({
            ...result.rows[0],
            lista: listaVentas.rows
        });

    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ... (El resto de tus rutas siguen igual) ...