const pool = require('../db.js');
const { z } = require('zod');

// ==========================================
// 1. ESQUEMAS DE VALIDACIÓN (ZOD)
// ==========================================
const abrirMesaSchema = z.object({
    minutos: z.number().int().min(0)
});

const cerrarMesaSchema = z.object({
    metodo: z.enum(['EFECTIVO', 'DIGITAL', 'MIXTO']),
    pago_efectivo: z.number().optional(),
    pago_digital: z.number().optional()
});

const cambiarMesaSchema = z.object({
    idOrigen: z.number().int(),
    idDestino: z.number().int()
});

// ==========================================
// 2. FUNCIONES AUXILIARES
// ==========================================
// ==========================================
// 2. FUNCIONES AUXILIARES (Blindada)
// ==========================================
async function getPrecioBillar() {
    try {
        // Intenta buscar en la base de datos
        const r = await pool.query("SELECT valor FROM configuracion WHERE clave = 'PRECIO_HORA_BILLAR'");
        return parseFloat(r.rows[0]?.valor || 10);
    } catch (error) {
        // Si la tabla no existe o hay error, no colapsa el servidor (Error 500)
        // Simplemente imprime una alerta en rojo y devuelve la tarifa de 10 Soles.
        console.error("⚠️ Alerta en DB: No se pudo leer la tarifa. Usando S/ 10 por defecto.");
        return 10.00; 
    }
}
// ==========================================
// 3. CONTROLADORES (Lógica de Negocio)
// ==========================================

const obtenerMesas = async (req, res, next) => { 
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
};

const abrirMesa = async (req, res, next) => { 
    try { 
        const id = z.coerce.number().int().parse(req.params.id); 
        const val = abrirMesaSchema.parse(req.body); 
        await pool.query('UPDATE mesas SET estado = $1, hora_inicio = NOW(), tiempo_limite = $2 WHERE id = $3', ['OCUPADA', val.minutos, id]); 
        
        res.json({ success: true }); 
        
        // Emisión de Sockets vía req.app
        const io = req.app.get('socketio');
        if (io) io.emit('actualizar_mesas'); 
    } catch(e){ next(e); } 
};

const detalleMesa = async (req, res, next) => { 
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
};

const cerrarMesa = async (req, res, next) => {
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
        
        const io = req.app.get('socketio');
        if (io) {
            io.emit('actualizar_mesas'); 
            io.emit('actualizar_caja'); 
        }
    } catch (err) { next(err); }
};

const cambiarMesa = async (req, res, next) => { 
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
        
        const io = req.app.get('socketio');
        if (io) io.emit('actualizar_mesas'); 
    } catch (e) { next(e); } 
};

module.exports = { obtenerMesas, abrirMesa, detalleMesa, cerrarMesa, cambiarMesa };