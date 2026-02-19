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

function abrirOpciones(id) {
    // Aquí puedes redirigir a una ventana de pedidos, o abrir un modal
    alert("Función de Pedidos en construcción (Falta agregar modal de productos HTML)");
}

// 6. FLUJO DE COBRO Y PAGO MIXTO
async function abrirModalCobro(id) {
    mesaAccionId = id;
    try {
        const res = await fetch(`/api/mesas/detalle/${id}`);
        const data = await res.json();
        
        totalDeudaCobro = parseFloat(data.totalFinal);

        let html = `
            <div style="background: #111; padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px; color:var(--text-muted);">
                    <span>⏳ Tiempo (${data.minutos} min):</span>
                    <span style="color:var(--gold); font-weight:bold;">S/ ${data.totalTiempo.toFixed(2)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; color:var(--text-muted);">
                    <span>🍺 Consumo:</span>
                    <span style="color:var(--success); font-weight:bold;">S/ ${data.totalProductos.toFixed(2)}</span>
                </div>
            </div>
            <div style="font-size: 28px; text-align:center; font-weight:900; color:white; margin-bottom: 20px;">
                TOTAL: <span style="color:var(--gold);">S/ ${totalDeudaCobro.toFixed(2)}</span>
            </div>
        `;
        document.getElementById('cobro-contenido').innerHTML = html;
        document.getElementById('modal-cobro').style.display = 'flex';
    } catch (e) { console.error("Error al obtener cuenta:", e); }
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