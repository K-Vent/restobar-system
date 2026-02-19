/* =========================================
   DASHBOARD JS - LA ESQUINA DEL BILLAR
   Lógica Profesional en Tiempo Real
   ========================================= */

const socket = io();
let intervaloCronometros = null;
let mesaAccionId = null;
let prodAccionId = null;
let mesaOrigenCambio = null;
let productosCache = [];
let mensajeTicketGlobal = "";
let lastMesasJSON = ""; 
let totalCobroActual = 0;

// Sonidos de alerta
const audioAviso = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
const audioFinal = new Audio('https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg');

// --- EVENTOS EN TIEMPO REAL (SOCKET.IO) ---
socket.on('actualizar_mesas', () => cargarMesas());
socket.on('actualizar_caja', () => actualizarCaja());

// --- INICIO DEL SISTEMA ---
async function cargarTodo() {
    await verificarRol();
    await cargarMesas();
    await actualizarCaja();
}

async function verificarRol() {
    try {
        const res = await fetch('/api/usuario/actual');
        const user = await res.json();
        if (user.rol !== 'admin') {
            document.querySelectorAll('.menu-link').forEach(link => {
                const href = link.getAttribute('href');
                if (href && (href.includes('inventario') || href.includes('reportes'))) {
                    link.style.display = 'none';
                }
            });
        }
    } catch (e) { console.error("Error verificando rol:", e); }
}

// --- GESTIÓN DE CAJA ---
async function actualizarCaja() {
    try {
        const res = await fetch('/api/caja/actual');
        const data = await res.json();
        document.getElementById('total-ventas').innerText = 'S/ ' + parseFloat(data.total_ventas).toFixed(2);
        document.getElementById('total-gastos').innerText = 'S/ ' + parseFloat(data.total_gastos).toFixed(2);
        document.getElementById('total-real').innerText = 'S/ ' + parseFloat(data.total_caja_real).toFixed(2);
    } catch (e) { console.error("Error actualizando caja:", e); }
}

async function ejecutarGasto() {
    const desc = document.getElementById('gasto-desc').value;
    const monto = document.getElementById('gasto-monto').value;
    if (!desc || !monto) return;
    const res = await fetch('/api/gastos/nuevo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descripcion: desc, monto: monto })
    });
    if (res.ok) {
        cerrarModal('modal-gasto');
        mostrarToast("💸 Gasto registrado");
    }
}

// --- GESTIÓN DE MESAS ---
async function cargarMesas() {
    try {
        const res = await fetch('/api/mesas');
        const mesas = await res.json();
        
        const currentJSON = JSON.stringify(mesas);
        if (currentJSON === lastMesasJSON) return;
        lastMesasJSON = currentJSON;

        const cont = document.getElementById('grid-mesas');
        cont.innerHTML = '';
        
        mesas.forEach(mesa => {
            const esOcupada = mesa.estado === 'OCUPADA';
            const esBillar = mesa.tipo === 'BILLAR';
            let fechaInicioJS = esOcupada && mesa.segundos > 0 
                ? new Date(Date.now() - (mesa.segundos * 1000)).toISOString() 
                : "";

            const dataAttrs = `data-id="${mesa.id}" data-inicio="${fechaInicioJS}" data-precio="${mesa.precio_hora}" data-limite="${mesa.tiempo_limite || 0}" data-mesa="${mesa.numero_mesa}"`;
            
            cont.innerHTML += `
                <div class="mesa-card">
                    <div class="mesa-header">
                        <div>
                            <div class="mesa-titulo">Mesa ${mesa.numero_mesa}</div>
                            <div class="mesa-subtitulo">${mesa.tipo}</div>
                        </div>
                        <span class="mesa-estado ${esOcupada ? 'ocupada' : 'libre'}">${esOcupada ? 'OCUPADA' : 'LIBRE'}</span>
                    </div>
                    ${esBillar ? `<div class="info-tiempo" id="timer-${mesa.id}" ${dataAttrs}>${esOcupada ? '...' : '--:--'}</div>` : '<div style="height:10px;"></div>'}
                    <div class="mesa-actions">
                        ${!esOcupada 
                            ? `<button class="btn-mesa btn-abrir" onclick="mostrarModalAbrir(${mesa.id})">🟢 INICIAR</button>` 
                            : `<button class="btn-mesa btn-producto" onclick="abrirModalProductos(${mesa.id})">🍺 PEDIDO</button>
                               <button class="btn-mesa btn-mover" onclick="abrirModalCambio(${mesa.id})">🔄 MOVER</button>
                               <button class="btn-mesa btn-cerrar" onclick="prepararCobro(${mesa.id}, '${mesa.numero_mesa}')">💰 COBRAR</button>`}
                    </div>
                </div>`;
        });
        iniciarCronometros();
    } catch (e) { console.error("Error cargando mesas:", e); }
}

function iniciarCronometros() {
    if (intervaloCronometros) clearInterval(intervaloCronometros);
    intervaloCronometros = setInterval(() => {
        document.querySelectorAll('.info-tiempo').forEach(t => {
            const inicio = t.getAttribute('data-inicio');
            if (!inicio || inicio === "") return;

            const precio = parseFloat(t.getAttribute('data-precio') || 10);
            const limite = parseInt(t.getAttribute('data-limite') || 0);
            const diff = new Date() - new Date(inicio);

            if (limite > 0) {
                const restMs = (limite * 60000) - diff;
                if (restMs <= 0) {
                    t.innerHTML = `<div style="color:#e74c3c; font-weight:bold; animation:parpadeo 1s infinite;">⛔ ¡TIEMPO!</div>`;
                } else {
                    const m = Math.floor(restMs / 60000);
                    const s = Math.floor((restMs % 60000) / 1000);
                    t.innerHTML = `⏳ ${m}:${s < 10 ? '0' + s : s}`;
                }
            } else {
                const m = Math.floor(diff / 60000);
                const costo = (diff / 3600000) * precio;
                t.innerHTML = `${Math.floor(m/60)}:${(m%60) < 10 ? '0'+(m%60) : (m%60)} <div class="dinero-vivo">S/ ${costo.toFixed(2)}</div>`;
            }
        });
    }, 1000);
}

// --- COBRO Y PAGO MIXTO ---
async function prepararCobro(id, numMesa) {
    mesaAccionId = id;
    document.getElementById('modal-cobro').style.display = 'flex';
    try {
        const res = await fetch(`/api/mesas/detalle/${id}`);
        const data = await res.json();
        totalCobroActual = data.totalFinal;
        
        let html = '';
        if (data.tipo === 'BILLAR') {
            html += `<div class="detalle-row"><span>🎱 Tiempo</span><span>S/ ${parseFloat(data.totalTiempo).toFixed(2)}</span></div>`;
        }
        data.listaProductos.forEach(p => {
            const nomSafe = p.nombre.replace(/'/g, "\\'");
            html += `<div class="detalle-row">
                <span>${p.cantidad}x ${p.nombre}</span>
                <span>S/ ${parseFloat(p.subtotal).toFixed(2)}</span>
            </div>`;
        });
        html += `<div class="detalle-row total-row"><span>TOTAL</span><span>S/ ${parseFloat(totalCobroActual).toFixed(2)}</span></div>`;
        document.getElementById('cobro-contenido').innerHTML = html;
    } catch (e) { console.error(e); }
}

function abrirCobroMixto() {
    cerrarModal('modal-cobro');
    document.getElementById('mixto-total').innerText = 'S/ ' + parseFloat(totalCobroActual).toFixed(2);
    document.getElementById('mixto-efectivo').value = '';
    document.getElementById('mixto-digital').value = parseFloat(totalCobroActual).toFixed(2);
    document.getElementById('modal-mixto').style.display = 'flex';
}

function calcularMixto() {
    let ef = parseFloat(document.getElementById('mixto-efectivo').value) || 0;
    if (ef > totalCobroActual) ef = totalCobroActual;
    document.getElementById('mixto-digital').value = (totalCobroActual - ef).toFixed(2);
}

async function ejecutarCobroReal(metodo) {
    let payload = { metodo: metodo };
    if (metodo === 'MIXTO') {
        payload.pago_efectivo = parseFloat(document.getElementById('mixto-efectivo').value) || 0;
        payload.pago_digital = parseFloat(document.getElementById('mixto-digital').value) || 0;
        cerrarModal('modal-mixto');
    } else {
        cerrarModal('modal-cobro');
    }

    const res = await fetch(`/api/mesas/cerrar/${mesaAccionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (res.ok) mostrarToast(`✅ Cobro exitoso: ${metodo}`);
}

// --- FUNCIONES DE UTILIDAD ---
function cerrarModal(id) { document.getElementById(id).style.display = 'none'; }
function mostrarToast(m) { 
    const t = document.getElementById("toast"); 
    t.innerText = m; t.classList.add("show"); 
    setTimeout(() => t.classList.remove("show"), 2500); 
}

window.onload = cargarTodo;