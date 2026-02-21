/* ============================================================
   AUDITORÍA.JS - LÓGICA DE LA BÓVEDA FORENSE
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
    await cargarAuditoria();
});

async function cargarAuditoria() {
    try {
        const res = await fetch('/api/auditoria');
        if (!res.ok) {
            window.location.href = '/dashboard.html'; // Expulsar si no es admin
            return;
        }
        
        const logs = await res.json();
        const tbody = document.getElementById('tabla-auditoria');
        tbody.innerHTML = '';

        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 30px; color: var(--success);">✅ Sistema limpio. No se han detectado alteraciones.</td></tr>`;
            return;
        }

        logs.forEach(log => {
            // Estilizar el tipo de acción
            let operacionHtml = '';
            if (log.operacion === 'DELETE') {
                operacionHtml = `<span style="background: rgba(255, 71, 87, 0.2); color: var(--danger); padding: 5px 10px; border-radius: 6px; font-weight: bold; font-size: 12px;">ELIMINACIÓN</span>`;
            } else {
                operacionHtml = `<span style="background: rgba(241, 196, 15, 0.2); color: var(--gold); padding: 5px 10px; border-radius: 6px; font-weight: bold; font-size: 12px;">MODIFICACIÓN</span>`;
            }

            // Traducir el JSON a texto legible
            const evidencia = formatearEvidencia(log.datos_anteriores, log.nombre_tabla);

            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid var(--border); transition: 0.2s;">
                    <td style="padding: 15px; color: var(--text-muted); font-size: 13px;">${log.fecha_formateada}</td>
                    <td style="padding: 15px; font-weight: bold; text-transform: uppercase;">${log.nombre_tabla}</td>
                    <td style="padding: 15px;">${operacionHtml}</td>
                    <td style="padding: 15px; color: var(--gold);">#${log.registro_id}</td>
                    <td style="padding: 15px; font-size: 12px; font-family: monospace; color: #ccc;">${evidencia}</td>
                </tr>
            `;
        });
    } catch (error) {
        console.error("Error al cargar la bóveda:", error);
    }
}

// Formateador para traducir la data técnica
function formatearEvidencia(json, tabla) {
    if (!json) return "Sin datos";
    
    if (tabla === 'gastos') {
        return `Gasto Anulado: "${json.descripcion}" por el monto de S/ ${parseFloat(json.monto).toFixed(2)}`;
    } else if (tabla === 'pedidos_mesa') {
        return `Pedido Anulado: Cantidad ${json.cantidad}. (Asociado a Mesa ID: ${json.mesa_id}, Producto ID: ${json.producto_id})`;
    } else if (tabla === 'mesas') {
        return `Mesa Alterada: #${json.numero_mesa} (Estado anterior: ${json.estado})`;
    }
    
    return JSON.stringify(json).replace(/["{}]/g, ' ').trim();
}