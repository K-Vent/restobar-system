/* ============================================================
   DASHBOARD.JS - SISTEMA GESTIÓN "LA ESQUINA DEL BILLAR"
   Versión: Premium POS / Sincronizado con server.js
   ============================================================ */

const socket = io(); // Conexión en tiempo real
let intervaloCronometros = null;
let mesaAccionId = null; 
let usuarioActual = null;
let totalDeudaCobro = 0; // Memoria temporal para Pagos Mixtos

// 1. INICIALIZACIÓN
document.addEventListener("DOMContentLoaded", async () => {
    await verificarRol();
    await cargarMesas();
    if(usuarioActual && usuarioActual.rol === 'admin') {
        cargarCaja();
    }
});

// Sockets (Escuchan al servidor y actualizan la pantalla solos)
socket.on('actualizar_mesas', () => cargarMesas());
socket.on('actualizar_caja', () => { 
    if(usuarioActual && usuarioActual.rol === 'admin') cargarCaja(); 
});

// 2. SEGURIDAD (Capa Visual)
async function verificarRol() {
    try {
        const res = await fetch('/api/usuario/actual');
        usuarioActual = await res.json();
        
        // Si no es admin, ocultamos módulos críticos
        if (usuarioActual.rol !== 'admin') {
            console.log("🔒 Modo Operativo (Mozo) Activado");
            document.querySelectorAll('.menu-link').forEach(link => {
                const txt = link.innerText.toLowerCase();
                if (txt.includes('inventario') || txt.includes('historial') || txt.includes('cerrar caja')) {
                    link.style.display = 'none';
                }
            });
            const moneyPanel = document.querySelector('.money-panel');
            if (moneyPanel) moneyPanel.style.display = 'none';
            const btnGasto = document.querySelector('.btn-gasto');
            if (btnGasto) btnGasto.style.display = 'none';
        }
    } catch (e) { console.error("Error en validación de seguridad:", e); }
}

// 3. CARGA DE CAJA SUPERIOR (Solo Admin)
async function cargarCaja() {
    try {
        const res = await fetch('/api/caja/actual');
        const data = await res.json();
        document.getElementById('total-ventas').innerText = 'S/ ' + parseFloat(data.total_ventas).toFixed(2);
        document.getElementById('total-gastos').innerText = 'S/ ' + parseFloat(data.total_gastos).toFixed(2);
        document.getElementById('total-real').innerText = 'S/ ' + parseFloat(data.dinero_en_cajon).toFixed(2);
    } catch (e) { console.log("Caja no disponible u oculta."); }
}

// 4. RENDERIZADO DE MESAS PREMIUM
async function cargarMesas() {
    try {
        const res = await fetch('/api/mesas');
        const mesas = await res.json();
        renderizarMesas(mesas);
    } catch (error) { console.error("Error al cargar mesas:", error); }
}

function renderizarMesas(mesas) {
    const grid = document.getElementById('grid-mesas');
    grid.innerHTML = '';
    clearInterval(intervaloCronometros);

    mesas.forEach(mesa => {
        const isOcupada = mesa.estado === 'OCUPADA';
        const estadoClass = isOcupada ? 'ocupada' : 'libre';
        const estadoTexto = isOcupada ? 'OCUPADA' : 'LIBRE';
        const icono = mesa.tipo === 'BILLAR' ? '🎱' : '🛒';
        
        let html = `
            <div class="mesa-card">
                <div class="mesa-header">
                    <div class="mesa-titulo">${icono} MESA ${mesa.numero_mesa}</div>
                    <div class="mesa-estado ${estadoClass}">${estadoTexto}</div>
                </div>
        `;

        if (isOcupada) {
            html += `
                <div class="info-tiempo" id="tiempo-${mesa.id}" data-segundos="${mesa.segundos}" data-tipo="${mesa.tipo}" data-precio="${mesa.precio_hora}">
                    ${mesa.tipo === 'BILLAR' ? '00:00:00' : 'MESA CONSUMO'}
                </div>
                <div style="text-align:center; margin-bottom:15px;">
                    <span class="dinero-vivo" id="dinero-${mesa.id}">S/ 0.00</span>
                </div>
                <div class="acciones-grid">
                    <button class="btn-mesa btn-producto" onclick="abrirOpciones(${mesa.id})">🍺 PEDIR</button>
                    <button class="btn-mesa btn-cerrar" onclick="abrirModalCobro(${mesa.id})">💰 COBRAR</button>
                </div>
            `;
        } else {
            html += `
                <div style="flex-grow:1; display:flex; align-items:center; justify-content:center; padding: 30px 0;">
                    <span style="color:var(--text-muted); font-size:14px; font-weight:700; text-transform:uppercase; letter-spacing:1px;">Mesa Disponible</span>
                </div>
                <button class="btn-mesa btn-abrir" onclick="abrirMesa(${mesa.id})">▶ INICIAR MESA</button>
            `;
        }

        html += `</div>`;
        grid.innerHTML += html;
    });

    iniciarCronometros();
}

// 5. ACCIONES DE MESAS
async function abrirMesa(id) {
    try {
        const res = await fetch(`/api/mesas/abrir/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ minutos: 0 })
        });
        if (res.ok) mostrarToast("Mesa Iniciada");
        else alert("No se pudo iniciar la mesa. Verifica la conexión.");
    } catch (e) { alert("Error de red."); }
}

// --- NUEVA LÓGICA DE PEDIDOS ---
let productosDisponibles = [];

// Esto debe ir dentro de tu document.addEventListener("DOMContentLoaded", async () => { ... })
// Asegúrate de agregar esta línea ahí dentro: await cargarProductosMenu();

async function cargarProductosMenu() {
    try {
        const res = await fetch('/api/productos');
        productosDisponibles = await res.json();
    } catch (e) { console.error("Error al cargar productos", e); }
}

function abrirOpciones(id) {
    mesaAccionId = id;
    if(productosDisponibles.length === 0) cargarProductosMenu(); // Por si acaso
    renderizarProductosMesa(productosDisponibles);
    document.getElementById('modal-pedidos').style.display = 'flex';
    document.getElementById('buscador-productos').value = '';
    document.getElementById('buscador-productos').focus();
}

function renderizarProductosMesa(productos) {
    const container = document.getElementById('lista-productos-mesa');
    container.innerHTML = '';
    productos.forEach(p => {
        const stockColor = p.stock > 0 ? 'var(--success)' : 'var(--danger)';
        container.innerHTML += `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#111; padding:15px; border-radius:10px; border:1px solid var(--border);">
                <div style="flex-grow: 1;">
                    <div style="font-weight:bold; color:white; font-size:16px; margin-bottom: 4px;">${p.nombre}</div>
                    <div style="color:var(--text-muted); font-size:12px;">Stock: <span style="color:${stockColor}; font-weight:bold;">${p.stock}</span> | <span style="color:var(--gold);">S/ ${parseFloat(p.precio_venta).toFixed(2)}</span></div>
                </div>
                <div style="display:flex; align-items:center; gap: 10px;">
                    <input type="number" id="cant-${p.id}" value="1" min="1" max="${p.stock}" 
                           style="width: 50px; background: #222; color: white; border: 1px solid #444; border-radius: 6px; padding: 10px; text-align: center; font-weight: bold; font-size: 16px;" 
                           ${p.stock <= 0 ? 'disabled' : ''}>
                    
                    <button class="btn-mesa" style="background:var(--gold); color:#000; padding:10px 18px; font-size:13px;" 
                            onclick="agregarPedido(${p.id})" ${p.stock <= 0 ? 'disabled' : ''}>
                        + AÑADIR
                    </button>
                </div>
            </div>
        `;
    });
}

function filtrarProductosMesa() {
    const txt = document.getElementById('buscador-productos').value.toLowerCase();
    const filtrados = productosDisponibles.filter(p => p.nombre.toLowerCase().includes(txt));
    renderizarProductosMesa(filtrados);
}

async function agregarPedido(productoId) {
    // Leemos la cantidad del input que acabamos de crear
    const cantInput = document.getElementById(`cant-${productoId}`);
    const cantidadSeleccionada = parseInt(cantInput.value) || 1;

    if (cantidadSeleccionada <= 0) return alert("La cantidad debe ser mayor a 0");

    try {
        const res = await fetch('/api/pedidos/agregar', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ mesa_id: mesaAccionId, producto_id: productoId, cantidad: cantidadSeleccionada })
        });
        if (res.ok) {
            mostrarToast(`✅ ${cantidadSeleccionada}x añadido(s)`);
            await cargarProductosMenu(); // Actualizar stock local
            abrirOpciones(mesaAccionId); // Refrescar modal
        } else {
            alert("Error al añadir producto (¿Revisaste si hay stock suficiente?)");
        }
    } catch (e) { console.error(e); }
}

// 6. FLUJO DE COBRO Y PAGO MIXTO
async function abrirModalCobro(id) {
    mesaAccionId = id;
    try {
        const res = await fetch(`/api/mesas/detalle/${id}`);
        const data = await res.json();
        
        totalDeudaCobro = parseFloat(data.totalFinal);

        // 1. Construir la lista detallada de productos
        let listaHtml = '';
        if (data.listaProductos && data.listaProductos.length > 0) {
            data.listaProductos.forEach(p => {
                listaHtml += `
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #222; padding: 10px 0; font-size: 14px;">
                        <div style="color: white; font-weight: 500;">
                            <span style="color:var(--gold); margin-right:5px;">${p.cantidad}x</span> ${p.nombre}
                        </div>
                        <div style="display:flex; gap: 12px; align-items:center;">
                            <span style="color:var(--success); font-weight:bold;">S/ ${parseFloat(p.subtotal).toFixed(2)}</span>
                            <button style="background:var(--danger-dim); color:var(--danger); border:1px solid rgba(255, 71, 87, 0.3); border-radius:6px; padding:6px 10px; cursor:pointer; transition:0.2s;" 
                                    onclick="eliminarPedido(${p.id}, ${id})" title="Quitar de la cuenta">🗑️</button>
                        </div>
                    </div>
                `;
            });
        } else {
            listaHtml = '<div style="color:var(--text-muted); font-size:13px; text-align:center; padding: 15px 0;">No hay consumo registrado</div>';
        }

        // 2. Construir la vista final del modal
        let html = `
            <div style="background: #111; padding: 20px; border-radius: 12px; margin-bottom: 20px; border: 1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; margin-bottom:15px; color:var(--text-muted); border-bottom:1px dashed #333; padding-bottom:15px;">
                    <span style="font-weight:600;">⏳ Tiempo Jugado (${data.minutos} min):</span>
                    <span style="color:var(--gold); font-weight:800; font-size:16px;">S/ ${data.totalTiempo.toFixed(2)}</span>
                </div>
                
                <div style="margin-bottom:10px; color:var(--text-muted); font-size: 12px; text-transform: uppercase; font-weight:bold; letter-spacing:1px;">
                    🍺 Detalle de Consumo:
                </div>
                
                <div style="max-height: 180px; overflow-y: auto; padding-right: 5px; margin-bottom: 10px;">
                    ${listaHtml}
                </div>
            </div>
            
            <div style="font-size: 32px; text-align:center; font-weight:900; color:white; margin-bottom: 25px;">
                TOTAL: <span style="color:var(--gold); text-shadow: 0 0 15px rgba(241,196,15,0.4);">S/ ${totalDeudaCobro.toFixed(2)}</span>
            </div>
        `;
        document.getElementById('cobro-contenido').innerHTML = html;
        document.getElementById('modal-cobro').style.display = 'flex';
    } catch (e) { console.error("Error al obtener cuenta:", e); }
}

// Nueva función para el botón de la papelera
async function eliminarPedido(idPedido, idMesa) {
    if (!confirm("⚠️ ¿Seguro que quieres quitar este producto de la cuenta? El stock regresará a tu inventario automáticamente.")) return;
    
    try {
        const res = await fetch(`/api/pedidos/eliminar/${idPedido}`, { method: 'DELETE' });
        if (res.ok) {
            mostrarToast("🗑️ Producto retirado de la cuenta");
            // Recargamos el modal de cobro para que el total se actualice matemáticamente
            abrirModalCobro(idMesa); 
        }
    } catch (e) { console.error(e); }
}

function abrirCobroMixto() {
    document.getElementById('modal-cobro').style.display = 'none';
    document.getElementById('mixto-total').innerText = 'S/ ' + totalDeudaCobro.toFixed(2);
    document.getElementById('mixto-efectivo').value = '';
    document.getElementById('mixto-digital').value = '';
    document.getElementById('modal-mixto').style.display = 'flex';
    document.getElementById('mixto-efectivo').focus();
}

function calcularMixto() {
    let ef = parseFloat(document.getElementById('mixto-efectivo').value) || 0;
    let dig = totalDeudaCobro - ef;
    if (dig < 0) dig = 0;
    document.getElementById('mixto-digital').value = dig.toFixed(2);
}

async function ejecutarCobroReal(metodo) {
    let ef = 0; let dig = 0;
    
    if (metodo === 'MIXTO') {
        ef = parseFloat(document.getElementById('mixto-efectivo').value) || 0;
        dig = parseFloat(document.getElementById('mixto-digital').value) || 0;
        if ((ef + dig).toFixed(2) !== totalDeudaCobro.toFixed(2)) {
            return alert("Los montos no cuadran con el total exacto.");
        }
    }

    try {
        const res = await fetch(`/api/mesas/cerrar/${mesaAccionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metodo: metodo, pago_efectivo: ef, pago_digital: dig })
        });
        
        if (res.ok) {
            cerrarModal('modal-cobro');
            cerrarModal('modal-mixto');
            mostrarToast("💳 Cobro Registrado");
        }
    } catch (e) { alert("Error al cobrar."); }
}

// 7. GASTOS
async function ejecutarGasto() {
    const desc = document.getElementById('gasto-desc').value;
    const monto = document.getElementById('gasto-monto').value;
    if (!desc || !monto) return alert("Llena todos los campos");

    await fetch('/api/gastos/nuevo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descripcion: desc, monto: parseFloat(monto) })
    });
    
    cerrarModal('modal-gasto');
    document.getElementById('gasto-desc').value = '';
    document.getElementById('gasto-monto').value = '';
    mostrarToast("💸 Gasto Registrado");
}

// 8. UTILIDADES
function cerrarModal(id) { document.getElementById(id).style.display = 'none'; }
function mostrarToast(msg) { 
    const t = document.getElementById("toast"); 
    t.innerText = msg; t.className = "show"; 
    setTimeout(() => t.className = t.className.replace("show",""), 2500); 
}

// 9. MATEMÁTICAS DEL CRONÓMETRO
function iniciarCronometros() {
    intervaloCronometros = setInterval(() => {
        document.querySelectorAll('.info-tiempo').forEach(el => {
            if (el.dataset.tipo !== 'BILLAR') return;
            
            let seg = parseInt(el.dataset.segundos);
            seg++;
            el.dataset.segundos = seg;

            let h = Math.floor(seg / 3600);
            let m = Math.floor((seg % 3600) / 60);
            let s = seg % 60;
            el.innerText = [h, m, s].map(v => v < 10 ? "0" + v : v).join(":");

            let precioHora = parseFloat(el.dataset.precio || 10);
            let minCalculo = Math.ceil(seg / 60) - 5; 
            let bloques = Math.ceil(minCalculo / 30);
            if (bloques < 1) bloques = 1;
            let costoT = (bloques * 30 / 60) * precioHora;

            const lblDinero = document.getElementById('dinero-' + el.id.split('-')[1]);
            if (lblDinero) lblDinero.innerText = 'S/ ' + costoT.toFixed(2);
        });
    }, 1000);
}