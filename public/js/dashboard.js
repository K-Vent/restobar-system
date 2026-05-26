/* ============================================================
   DASHBOARD.JS - SISTEMA GESTIÓN "LA ESQUINA DEL BILLAR"
   ============================================================ */
// ==========================================
// ESTADO GLOBAL DEL SISTEMA
// ==========================================
let mesaActivaParaCobro = null;
 
const socket = io(); 
let intervaloCronometros = null;
let mesaAccionId = null; 
let mesaOrigenMoveId = null;
let usuarioActual = null;
let totalDeudaCobro = 0; 
let productosDisponibles = [];
let filtroActual = 'TODAS';
let todasLasMesas = [];

// ==========================================
// 1. INICIALIZACIÓN — UN SOLO DOMContentLoaded
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    await verificarRol();
    await cargarMesas();
    await cargarProductosMenu();
    if (usuarioActual && usuarioActual.rol === 'admin') cargarCaja();
    cargarEventos();
    aplicarPermisosUI();
});
 
socket.on('actualizar_mesas', () => cargarMesas());
socket.on('actualizar_caja', () => { 
    if (usuarioActual && usuarioActual.rol === 'admin') cargarCaja(); 
});



// ==========================================
// 2. SEGURIDAD Y CARGAS INICIALES
// ==========================================
async function verificarRol() {
    try {
        const res = await fetch('/api/usuario/actual');
        usuarioActual = await res.json();
        if (usuarioActual.rol !== 'admin') {
            document.querySelectorAll('.menu-link').forEach(link => {
                const txt = link.innerText.toLowerCase();
                if (txt.includes('inventario') || txt.includes('historial') || txt.includes('cerrar caja') || txt.includes('empleados')) 
                    link.style.display = 'none';
            });
            const moneyPanel = document.querySelector('.money-panel');
            if (moneyPanel) moneyPanel.style.display = 'none';
            const btnGasto = document.querySelector('.btn-gasto');
            if (btnGasto) btnGasto.style.display = 'none';
        }
    } catch (e) { console.error("Error en validación de seguridad:", e); }
}

async function cargarCaja() {
    try {
        const res = await fetch('/api/caja/actual');
        const data = await res.json();
        document.getElementById('total-ventas').innerText = 'S/ ' + parseFloat(data.total_ventas).toFixed(2);
        document.getElementById('total-gastos').innerText = 'S/ ' + parseFloat(data.total_gastos).toFixed(2);
        document.getElementById('total-real').innerText = 'S/ ' + parseFloat(data.dinero_en_cajon).toFixed(2);
    } catch (e) { console.log("Caja no disponible u oculta."); }
}
 
async function cargarProductosMenu() {
    try {
        const res = await fetch('/api/productos');
        productosDisponibles = await res.json();
    } catch (e) { console.error("Error al cargar productos", e); }
}

// ==========================================
// 3. RENDERIZADO DE MESAS Y TIEMPO
// ==========================================
async function cargarMesas() {
    try {
        const res = await fetch('/api/mesas');
        todasLasMesas = await res.json();
        filtrarMesas();
    } catch (error) { console.error("Error al cargar mesas:", error); }
}
 
function setFiltro(tipo, btn) {
    filtroActual = tipo;
    document.querySelectorAll('.btn-group .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filtrarMesas();
}

function filtrarMesas() {
    const inputBusqueda = document.getElementById('busqueda-mesa');
    if (!inputBusqueda) return; 
    
    const busqueda = inputBusqueda.value.toLowerCase();
    
    const filtradas = todasLasMesas.filter(m => {
        const cumpleTipo = filtroActual === 'TODAS' || 
                           (filtroActual === 'OCUPADA' && m.estado === 'OCUPADA') ||
                           (filtroActual === 'BILLAR' && m.tipo === 'BILLAR');
        const numeroSeguro = String(m.numero_mesa || '').toLowerCase();
        return cumpleTipo && numeroSeguro.includes(busqueda);
    });
 
    renderizarMesas(filtradas);
}

function renderizarMesas(mesas) {
    const grid = document.getElementById('grid-mesas');
    if (!grid) return; 
    
    grid.innerHTML = '';
    grid.className = 'row g-3'; 
 
    // FIX: Siempre limpiar el intervalo anterior antes de redibujar
    clearInterval(intervaloCronometros);
    intervaloCronometros = null;
 
    mesas.forEach(mesa => {
        const isOcupada = mesa.estado === 'OCUPADA';
        const claseTarjeta = isOcupada ? 'card-mesa card-mesa-ocupada' : 'card-mesa card-mesa-libre';
        const statusBadge = isOcupada ? 'bg-warning text-dark fw-bold' : 'bg-dark border border-secondary text-muted';
        const icono = mesa.tipo === 'BILLAR' ? '<i data-lucide="circle-dot" style="width:16px;"></i>' : '<i data-lucide="coffee" style="width:16px;"></i>';
 
        grid.innerHTML += `
        <div class="col-12 col-md-6 col-lg-4 col-xl-3">
            <div class="card ${claseTarjeta} h-100">
                <div class="card-body d-flex flex-column p-3">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h6 class="fw-bold mb-0 text-white" style="letter-spacing: 0.5px;">${icono} MESA ${mesa.numero_mesa}</h6>
                        <span class="badge ${statusBadge} shadow-sm px-2 py-1">${mesa.estado}</span>
                    </div>
 
                    ${isOcupada ? `
                        <div class="text-center py-3 rounded-3 mb-3" style="background: #000; border: 1px solid rgba(212,175,55,0.2);">
                            <h2 class="display-6 fw-bold mb-0 info-tiempo text-white" id="tiempo-${mesa.id}" 
                                data-segundos="${mesa.segundos}" data-tipo="${mesa.tipo}" data-precio="${mesa.precio_hora}"
                                style="letter-spacing: 2px;">
                                ${mesa.tipo === 'BILLAR' ? '00:00:00' : 'CONSUMO'}
                            </h2>
                            <p class="fs-4 fw-bold text-warning mb-0 mt-1" id="dinero-${mesa.id}">S/ 0.00</p>
                        </div>
                        <div class="mt-auto d-grid gap-2">
                            <div class="row g-2">
                                <div class="col-6"><button class="btn btn-warning fw-bold w-100 py-2 shadow-sm" onclick="abrirOpciones(${mesa.id})"><i data-lucide="plus-circle" style="width:14px; margin-right:4px;"></i> PEDIR</button></div>
                                <div class="col-6"><button class="btn btn-light fw-bold text-dark w-100 py-2 shadow-sm" onclick="abrirModalCobro(${mesa.id})"><i data-lucide="banknote" style="width:14px; margin-right:4px;"></i> COBRAR</button></div>
                            </div>
                            <button class="btn btn-dark border-secondary btn-sm text-light mt-1" onclick="abrirModalMover(${mesa.id})"><i data-lucide="arrow-right-left" style="width:12px; margin-right:4px;"></i> MUDAR</button>
                        </div>
                    ` : `
                        <div class="text-center py-4 flex-grow-1 d-flex flex-column justify-content-center">
                            <p class="small text-muted mb-0 fw-bold" style="letter-spacing: 1px;">TARIFA BASE</p>
                            <p class="fs-5 text-white opacity-50 mb-0">S/ ${parseFloat(mesa.precio_hora || 0).toFixed(2)} / hr</p>
                        </div>
                        <div class="mt-auto">
                            <button class="btn btn-iniciar-mesa w-100 fw-bold py-3 text-uppercase" onclick="abrirMesa(${mesa.id})">
                                <i data-lucide="play" style="width:14px; margin-right:4px;"></i> Iniciar Mesa
                            </button>
                        </div>
                    `}
                </div>
            </div>
        </div>
        `;
    });
 
    iniciarCronometros();
}
// ==========================================
// 4. CRONÓMETROS
// ==========================================
function iniciarCronometros() {
    if (intervaloCronometros) {
        clearInterval(intervaloCronometros);
        intervaloCronometros = null;
    }
 
    intervaloCronometros = setInterval(() => {
        document.querySelectorAll('.info-tiempo').forEach(el => {
            try {
                if (el.dataset.tipo !== 'BILLAR') return;
 
                let seg = parseInt(el.dataset.segundos);
                if (isNaN(seg)) seg = 0;
 
                seg++;
                el.dataset.segundos = seg;
 
                const h = Math.floor(seg / 3600);
                const m = Math.floor((seg % 3600) / 60);
                const s = seg % 60;
                el.innerText = 
                    String(h).padStart(2, '0') + ':' +
                    String(m).padStart(2, '0') + ':' +
                    String(s).padStart(2, '0');
 
                const precioHora = parseFloat(el.dataset.precio || 10);
                const minutosTotales = Math.floor(seg / 60);
                let costoT = 0;
 
                if (minutosTotales > 5) {
                    const bloques = Math.ceil((minutosTotales - 5) / 30);
                    costoT = bloques * (precioHora / 2);
                }
 
                const mesaId = el.id.split('-')[1];
                const lblDinero = document.getElementById('dinero-' + mesaId);
                if (lblDinero) lblDinero.innerText = 'S/ ' + costoT.toFixed(2);
 
            } catch (error) {
                console.error("Error en cronómetro:", error);
            }
        });
    }, 1000);
}

// ==========================================
// 5. ACCIONES DE MUDANZA
// ==========================================
async function abrirModalMover(idOrigen) {
    mesaOrigenMoveId = idOrigen;
    try {
        const res = await fetch('/api/mesas');
        const mesas = await res.json();
        const libres = mesas.filter(m => m.estado === 'LIBRE');
        
        if (libres.length === 0) {
            return mostrarAlerta("No hay ninguna mesa libre disponible para realizar el traslado.");
        }
 
        const select = document.getElementById('select-mesa-destino');
        select.innerHTML = '';
        libres.forEach(m => {
            const nomIcono = m.tipo === 'BILLAR' ? 'Billar' : 'Consumo';
            select.innerHTML += `<option value="${m.id}">${nomIcono} Mesa ${m.numero_mesa}</option>`;
        });
 
        document.getElementById('modal-mover').style.display = 'flex';
    } catch (e) {
        mostrarAlerta("Error al buscar las mesas libres disponibles.");
    }
}

async function ejecutarMoverMesa() {
    const idDestino = document.getElementById('select-mesa-destino').value;
    if (!idDestino) return;
 
    try {
        const res = await fetch('/api/mesas/cambiar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idOrigen: mesaOrigenMoveId, idDestino: parseInt(idDestino) })
        });
 
        if (res.ok) {
            cerrarModal('modal-mover');
            mostrarToast("Mudanza realizada con éxito");
            cargarMesas(); 
        } else {
            mostrarAlerta("Error en el servidor al intentar mover la mesa.");
        }
    } catch (e) {
        mostrarAlerta("Error de conexión al procesar la mudanza.");
    }
}

// ==========================================
// 6. ACCIONES DE MESAS Y PEDIDOS
// ==========================================
async function abrirMesa(id) {
    try {
        const res = await fetch(`/api/mesas/abrir/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ minutos: 0 })
        });
        if (res.ok) mostrarToast("Mesa Iniciada");
        else mostrarAlerta("No se pudo iniciar la mesa. Verifica la conexión.");
    } catch (e) { mostrarAlerta("Error de red al intentar abrir mesa."); }
}
 
function abrirOpciones(id) {
    mesaAccionId = id;
    if (productosDisponibles.length === 0) cargarProductosMenu(); 
    renderizarProductosMesa(productosDisponibles);
    
    const inputNombre = document.getElementById('nombrePersonaPedido');
    if (inputNombre) inputNombre.value = '';
    
    document.getElementById('modal-pedidos').style.display = 'flex';
    
    cargarNombresRapidos();
    
    document.getElementById('buscador-productos').value = '';
    document.getElementById('buscador-productos').focus();
}

function renderizarProductosMesa(productos) {
    const container = document.getElementById('lista-productos-mesa');
    container.innerHTML = '';
    
    productos.forEach(p => {
        const isOutOfStock = p.stock <= 0;
        const stockBadge = isOutOfStock 
            ? '<span class="badge bg-danger">Agotado</span>' 
            : `<span class="badge border border-success text-success">Stock: ${p.stock}</span>`;
 
        container.innerHTML += `
            <div class="card bg-dark border-secondary mb-2 shadow-sm">
                <div class="card-body p-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div class="flex-grow-1">
                        <h6 class="text-white fw-bold mb-1">${p.nombre}</h6>
                        <div class="d-flex align-items-center gap-2">
                            ${stockBadge}
                            <span class="text-warning fw-bold">S/ ${parseFloat(p.precio_venta).toFixed(2)}</span>
                        </div>
                    </div>
                    <div class="d-flex align-items-center gap-2 mt-2 mt-sm-0">
                        <div class="input-group-cantidad">
                            <button class="btn-qty" onclick="cambiarQty(${p.id}, -1)" ${isOutOfStock ? 'disabled' : ''}>-</button>
                            <input type="number" id="cant-${p.id}" value="1" min="1" max="${p.stock}" 
                                   class="input-qty-num" 
                                   oninput="validarManual(${p.id}, ${p.stock})">
                            <button class="btn-qty" onclick="cambiarQty(${p.id}, 1)" ${isOutOfStock ? 'disabled' : ''}>+</button>
                        </div>
                        <button class="btn btn-warning fw-bold shadow-sm" 
                                onclick="agregarPedido(${p.id})" ${isOutOfStock ? 'disabled' : ''}>
                            AÑADIR
                        </button>
                    </div>
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
    const cantInput = document.getElementById(`cant-${productoId}`);
    const cantidadSeleccionada = parseInt(cantInput.value) || 1;
    
    const inputNombre = document.getElementById('nombrePersonaPedido');
    const nombrePersona = inputNombre ? inputNombre.value.trim() : '';

    if (cantidadSeleccionada <= 0) return mostrarAlerta("La cantidad debe ser mayor a 0");

    try {
        const res = await fetch('/api/pedidos/agregar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                mesa_id: mesaAccionId, 
                producto_id: productoId, 
                cantidad: cantidadSeleccionada,
                cliente_nombre: nombrePersona 
            })
        });
        
        if (res.ok) {
            mostrarToast("Añadido al pedido");
            
            if (inputNombre) inputNombre.value = '';

            await cargarProductosMenu(); 
            await cargarNombresRapidos();
            abrirOpciones(mesaAccionId); 
        } else {
            mostrarAlerta("Error al añadir producto");
        }
    } catch (e) { 
        mostrarAlerta("Error de red al añadir producto."); 
    }
}

async function eliminarPedido(idPedido, idMesa) {
    try {
        const confirmado = await mostrarConfirmacion("Retirar Producto", "¿Seguro que quieres quitar este producto de la cuenta?");
        if (confirmado) {
            const res = await fetch(`/api/pedidos/eliminar/${idPedido}`, { method: 'DELETE' });
            if (res.ok) {
                mostrarToast("Producto retirado de la cuenta");
                abrirModalCobro(idMesa);
            } else {
                mostrarAlerta("Error en el servidor al intentar eliminar.", "error");
            }
        }
    } catch (error) {
        console.error("Error en eliminarPedido:", error);
        mostrarAlerta("No se pudo cargar la confirmación.", "error");
    }
}
// ==========================================
// 7. COBRO Y PAGO MIXTO
// ==========================================
async function abrirModalCobro(id) {
    mesaAccionId = id;
    try {
        const res = await fetch(`/api/mesas/detalle/${id}`);
        const data = await res.json();
        
        totalDeudaCobro = parseFloat(data.totalFinal);

        let listaHtml = '';
        if (data.listaProductos && data.listaProductos.length > 0) {
            
            const cuentasPorPersona = {};
            data.listaProductos.forEach(p => {
                const nombre = p.cliente_nombre || 'General'; 
                if (!cuentasPorPersona[nombre]) {
                    cuentasPorPersona[nombre] = { total: 0, items: [] };
                }
                cuentasPorPersona[nombre].items.push(p);
                cuentasPorPersona[nombre].total += p.subtotal;
            });

            for (const [persona, cuenta] of Object.entries(cuentasPorPersona)) {
                
                listaHtml += `
                    <div class="mb-3 p-2 border rounded" style="background: rgba(255,255,255,0.02); border-color: var(--border)!important;">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span style="font-size: 13px; font-weight: 600;"><i data-lucide="user" style="width:14px;"></i> Cuenta: <span class="text-info text-uppercase">${persona}</span></span>
                            <span class="fw-bold" style="color: var(--success); font-size: 14px;">S/ ${cuenta.total.toFixed(2)}</span>
                        </div>
                    `;

                cuenta.items.forEach(p => {
                    listaHtml += `
                        <div class="d-flex justify-content-between align-items-center border-bottom border-secondary py-2 ps-3">
                            <div class="text-white">
                                <span class="text-warning me-2">${p.cantidad}x</span> ${p.nombre}
                            </div>
                            <div class="d-flex align-items-center gap-2">
                                <span class="text-muted small">S/ ${parseFloat(p.subtotal).toFixed(2)}</span>
                                <button class="btn btn-outline-danger btn-sm p-1" onclick="eliminarPedido(${p.id}, ${id})" title="Quitar de la cuenta"><i data-lucide="trash-2" style="width:14px;"></i></button>
                            </div>
                        </div>
                    `;
                });
                listaHtml += `</div>`;
            }
        } else {
            listaHtml = '<div class="text-muted text-center py-3 small">No hay consumo registrado</div>';
        }

        const html = `
            <div class="bg-black p-3 rounded mb-3 border border-secondary shadow-sm">
                <div class="mb-3 pb-3" style="border-bottom: 1px solid var(--border);">
                    <span class="fw-bold"><i data-lucide="clock" style="width:14px; margin-right:4px;"></i> Tiempo Jugado (${data.minutos} min):</span>
                    <span style="float: right; color: var(--success); font-weight: bold;">S/ ${data.totalTiempo.toFixed(2)}</span>
                </div>
                <div class="text-muted small text-uppercase fw-bold mb-2"><i data-lucide="coffee" style="width:14px; margin-right:4px;"></i> Detalle de Consumo:</div>
                <div style="max-height: 250px; overflow-y: auto;" class="pe-1">
                    ${listaHtml}
                </div>
            </div>
            <div class="text-center fw-bold text-white mb-4">
                <span class="fs-4">TOTAL MESA:</span> 
                <span class="fs-1 text-warning d-block" style="text-shadow: 0 0 15px rgba(241,196,15,0.4);">S/ ${totalDeudaCobro.toFixed(2)}</span>
            </div>
            <button class="btn btn-outline-warning w-100 mb-3 fw-bold mt-2" onclick="abrirScanner()" style="border-radius: var(--radius-md);">
                <i data-lucide="qr-code" style="width:16px; margin-right:4px;"></i> ESCANEAR SOCIO VIP (+1 Sello)
            </button>
        `;
        document.getElementById('cobro-contenido').innerHTML = html;
        document.getElementById('modal-cobro').style.display = 'flex';
    } catch (e) { console.error("Error al obtener cuenta:", e); }
}

async function cobrarCuentaPersonal(nombrePersona, montoDeuda) {
    if (!confirm(`¿Cobrar a ${nombrePersona} S/ ${montoDeuda.toFixed(2)}?`)) return;

    let metodoPrompt = prompt("Escribe 1 (Efectivo) o 2 (Digital)", "1");
    if (!metodoPrompt) return;

    let metodoFinal = metodoPrompt === '2' ? 'DIGITAL' : 'EFECTIVO';

    try {
        const res = await fetch(`/api/mesas/cerrar-personal/${mesaAccionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                cliente_nombre: nombrePersona, 
                metodo: metodoFinal 
            })
        });
        
        if (res.ok) {
            mostrarToast(`Cuenta de ${nombrePersona} cobrada`);
            abrirModalCobro(mesaAccionId); 
            cargarMesas(); 
            if (usuarioActual && usuarioActual.rol === 'admin') cargarCaja();
        } else {
            const data = await res.json();
            mostrarAlerta(data.error || "Error al procesar cobro parcial.");
        }
    } catch (e) { 
        mostrarAlerta("Error de conexión."); 
    }
}

async function cargarNombresRapidos() {
    try {
        const div = document.getElementById('nombresRapidos');
        div.innerHTML = ''; 

        const res = await fetch(`/api/mesas/${mesaAccionId}/nombres`);
        const nombres = await res.json();
        
        nombres.forEach(nombre => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm btn-outline-info fw-bold';
            btn.style.borderRadius = '15px';
            btn.style.padding = '2px 12px';
            btn.innerText = nombre;
            
            btn.onclick = () => {
                document.getElementById('nombrePersonaPedido').value = nombre;
            };
            
            div.appendChild(btn);
        });
    } catch(e) {
        console.error("Error cargando nombres rápidos", e);
    }
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
    let ef = 0; 
    let dig = 0;
    
    if (metodo === 'MIXTO') {
        ef = parseFloat(document.getElementById('mixto-efectivo').value) || 0;
        dig = parseFloat(document.getElementById('mixto-digital').value) || 0;
        if ((ef + dig).toFixed(2) !== totalDeudaCobro.toFixed(2)) {
            return mostrarAlerta("Los montos no cuadran.");
        }
    } else if (metodo === 'EFECTIVO') {
        ef = totalDeudaCobro;
        dig = 0;
    } else {
        ef = 0;
        dig = totalDeudaCobro;
    }
 
    let metodoParaDB = metodo;
    if (metodo === 'YAPE' || metodo === 'PLIN' || metodo === 'TARJETA') {
        metodoParaDB = 'DIGITAL'; 
    }
 
    try {
        const res = await fetch(`/api/mesas/cerrar/${mesaAccionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metodo: metodoParaDB, pago_efectivo: ef, pago_digital: dig })
        });
        
        if (res.ok) {
            cerrarModal('modal-cobro');
            cerrarModal('modal-mixto');
            mostrarToast(`Cuenta cobrada con éxito`);
            cargarMesas();
            if (usuarioActual && usuarioActual.rol === 'admin') cargarCaja();
        } else {
            const data = await res.json();
            mostrarAlerta(data.error || "Error al registrar cobro.");
        }
    } catch (e) { 
        mostrarAlerta("Error de conexión."); 
    }
}

// ==========================================
// 8. GASTOS Y UTILIDADES
// ==========================================
async function ejecutarGasto() {
    const desc = document.getElementById('gasto-desc').value;
    const monto = document.getElementById('gasto-monto').value;
    if (!desc || !monto) return mostrarAlerta("Llena todos los campos.");
 
    await fetch('/api/gastos/nuevo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descripcion: desc, monto: parseFloat(monto) })
    });
    
    cerrarModal('modal-gasto');
    document.getElementById('gasto-desc').value = '';
    document.getElementById('gasto-monto').value = '';
    mostrarToast("Gasto Registrado");
}

function cerrarModal(id) { document.getElementById(id).style.display = 'none'; }

function mostrarToast(msg) { 
    const t = document.getElementById("toast"); 
    t.innerText = msg; 
    t.className = "show"; 
    setTimeout(() => t.className = t.className.replace("show", ""), 2500); 
}



// ==========================================
// 9. ESCÁNER QR Y PERFIL VIP
// ==========================================
let escanerActivo = null;

function abrirScanner() {
    document.getElementById('modal-scanner').style.display = 'flex';
    escanerActivo = new Html5QrcodeScanner(
        "reader", 
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 }, 
        false
    );
    escanerActivo.render(escaneoExitoso, escaneoFallido);
}

function cerrarScanner() {
    if (escanerActivo) escanerActivo.clear(); 
    document.getElementById('modal-scanner').style.display = 'none';
}

function escaneoFallido(error) { }

async function escaneoExitoso(textoDecodificado) {
    cerrarScanner();
    
    try {
        const res = await fetch(`/api/vip/escanear/${textoDecodificado}`);
        const data = await res.json();
        
        if (!res.ok) return mostrarAlerta(data.error, "error");
 
        fetch(`/api/clientes/${data.id}/sello`, { method: 'POST' });
 
        document.getElementById('vip-nombre-caja').innerText = data.nombre;
        document.getElementById('vip-nivel-caja').innerText = `Socio ${data.nivel}`;
        
        const recompensaDiv = document.getElementById('vip-recompensa-caja');
        const btnContainer = document.getElementById('btn-container-canje');
        
        if (data.premios > 0) {
            recompensaDiv.innerHTML = `<span style="color: var(--gold); font-weight: 800; font-size: 14px;"><i data-lucide="gift" style="width:16px; margin-right:4px;"></i> ¡Tiene ${data.premios} Hora(s) Gratis disponible(s)!</span>`;
            btnContainer.innerHTML = `<button class="btn-mesa mt-3" style="background: var(--gold); color: #000; font-weight: 800; width: 100%; padding: 12px; border-radius: var(--radius-md); text-transform: uppercase; font-size: 13px;" onclick="ejecutarCanjeAgora(${data.id}, mesaAccionId)"><i data-lucide="check" style="width:16px; margin-right:4px;"></i> Aplicar Premio a esta Mesa</button>`;
        } else {
            recompensaDiv.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">No tiene recompensas disponibles aún.</span><br><span style="color: var(--success); font-weight: 600; font-size: 12px; display:inline-block; margin-top:8px;"><i data-lucide="check-circle-2" style="width:14px; margin-right:4px;"></i> +1 Sello añadido por su visita.</span>`;
            btnContainer.innerHTML = '';
        }
 
        document.getElementById('modal-perfil-vip').style.display = 'flex';
 
    } catch (error) {
        mostrarAlerta("Error al leer la tarjeta VIP.", "error");
    }
}

async function ejecutarCanjeAgora(idSocio, idMesa) {
    document.getElementById('modal-perfil-vip').style.display = 'none';
    const confirmado = await mostrarConfirmacion(" CONFIRMACIÓN DE SEGURIDAD", "¿Aplicar el descuento? Esta acción no se puede deshacer.");
    if (!confirmado) return;
 
    try {
        const res = await fetch('/api/transaccion/canje-seguro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idSocio, idMesa })
        });
 
        if (res.ok) {
            document.getElementById('modal-perfil-vip').style.display = 'none';
            document.getElementById('modal-cobro').style.display = 'none';
            mostrarAlerta(" ¡Descuento aplicado! La cuenta ha sido recalculada.", "success");
            await cargarMesas();
            abrirModalCobro(idMesa); 
        } else {
            const err = await res.json();
            mostrarAlerta(err.error, "error");
        }
    } catch (error) {
        mostrarAlerta("Error de conexión.", "error");
    }
}


// ==========================================
// 10. CONTROLES DE CANTIDAD
// ==========================================
function cambiarQty(id, delta) {
    const input = document.getElementById(`cant-${id}`);
    if (!input) return;
    let val = parseInt(input.value) || 1;
    val += delta;
    const min = parseInt(input.min) || 1;
    const max = parseInt(input.max) || 999;
    if (val < min) val = min;
    if (val > max) val = max;
    input.value = val;
}

function validarManual(id, maxStock) {
    const input = document.getElementById(`cant-${id}`);
    if (!input) return;
    let val = parseInt(input.value);
    if (val > maxStock) {
        input.value = maxStock;
        mostrarToast(`Solo hay ${maxStock} en stock`);
    }
    if (val < 1) input.value = 1;
}

// ==========================================
// 11. MENÚ MÓVIL
// ==========================================
function abrirMenuMovil() {
    document.querySelector('.sidebar').classList.add('abierto-movil');
    document.getElementById('overlay-sidebar').classList.add('activo');
}
 
function cerrarMenuMovil() {
    document.querySelector('.sidebar').classList.remove('abierto-movil');
    document.getElementById('overlay-sidebar').classList.remove('activo');
}

// ==========================================
// 12. INFRAESTRUCTURA (AÑADIR/QUITAR MESAS)
// ==========================================
function abrirModalGestionMesas() {
    if (usuarioActual && usuarioActual.rol !== 'admin') {
        return mostrarAlerta("Acceso denegado. Solo la gerencia puede alterar la infraestructura.", "error");
    }
    document.getElementById('modal-gestion-mesas').style.display = 'flex';
}

async function agregarMesaDB(tipo) {
    try {
        const res = await fetch('/api/mesas/crear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo })
        });
        if (res.ok) {
            mostrarToast("✅ Mesa añadida a la infraestructura");
            cargarMesas();
            document.getElementById('modal-gestion-mesas').style.display = 'none';
        } else {
            mostrarAlerta("Error en el servidor al intentar crear la mesa.");
        }
    } catch (e) {
        mostrarAlerta("Error de conexión al servidor.");
    }
}

async function eliminarUltimaMesaDB() {
    const confirmado = await mostrarConfirmacion(
        "⚠️ ALERTA DE INFRAESTRUCTURA", 
        "¿Estás seguro de eliminar la ÚLTIMA mesa registrada? Asegúrate de que esté vacía."
    );
    if (!confirmado) return;
 
    try {
        const res = await fetch('/api/mesas/eliminar-ultima', { method: 'DELETE' });
        if (res.ok) {
            mostrarToast("🗑️ Mesa retirada exitosamente");
            cargarMesas();
            document.getElementById('modal-gestion-mesas').style.display = 'none';
        } else {
            mostrarAlerta("No se pudo eliminar la mesa. Verifica si tiene cuentas activas.");
        }
    } catch (e) {
        mostrarAlerta("Error de conexión al servidor.");
    }
}

        // ==========================================
// 13. PERMISOS VISUALES (UI)
// ==========================================
async function aplicarPermisosUI() {
    try {
        const res = await fetch('/api/usuario/actual');
        if (res.ok) {
            const usuario = await res.json();
            if (usuario.rol !== 'admin') {
                const rutasProhibidas = [
                    '/inventario.html', '/clientes.html', '/reportes.html',
                    '/cierre_caja.html', '/auditoria.html', '/empleados.html'
                ];
                document.querySelectorAll('.sidebar a').forEach(link => {
                    if (rutasProhibidas.includes(link.getAttribute('href'))) {
                        link.style.display = 'none';
                    }
                });
                if (usuario.rol === 'cocina') {
                    const btnMesas = document.querySelector('.sidebar a[href="/dashboard.html"]');
                    if (btnMesas) btnMesas.style.display = 'none';
                }
            }
        }
    } catch (error) { console.error("Error verificando permisos visuales:", error); }
}




// ==========================================
// 14. EVENTOS PRIVADOS
// ==========================================
async function cargarEventos() {
    const tbody = document.getElementById('tablaEventosBody');
    if (!tbody) return;
 
    try {
        const res = await fetch('/api/eventos/lista');
        const eventos = await res.json();
 
        if (eventos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No hay eventos registrados aún.</td></tr>';
            return;
        }
 
        tbody.innerHTML = eventos.map(ev => {
            const colorEstado = ev.estado === 'Pendiente' ? 'bg-warning text-dark' : 
                                ev.estado === 'Aprobado'  ? 'bg-success text-white' : 'bg-danger text-white';
            const fechaFormateada = new Date(ev.fecha_evento).toLocaleDateString('es-PE');
 
            return `
                <tr>
                    <td><strong>${fechaFormateada}</strong><br><span class="small text-muted">⏰ ${ev.hora_inicio}</span></td>
                    <td>${ev.cliente_nombre}<br><a href="https://wa.me/51${ev.cliente_telefono}" target="_blank" class="text-success small text-decoration-none">💬 ${ev.cliente_telefono}</a></td>
                    <td>${ev.tipo_evento}<br><span class="badge bg-secondary">${ev.cantidad_personas}</span></td>
                    <td class="text-warning small">${ev.tipo_plan}</td>
                    <td class="small" style="max-width: 200px;">${ev.extras_seleccionados}</td>
                    <td class="text-center"><span class="badge ${colorEstado}">${ev.estado}</span></td>
                    <td class="text-center">
                        ${ev.estado === 'Pendiente' ? `
                            <button class="btn btn-sm btn-success mb-1" onclick="cambiarEstadoEvento(${ev.id}, 'Aprobado')">✓ Aprobar</button>
                            <button class="btn btn-sm btn-danger mb-1" onclick="cambiarEstadoEvento(${ev.id}, 'Rechazado')">✕ Rechazar</button>
                        ` : '<span class="text-muted small">Gestionado</span>'}
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error cargando eventos', error);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">Error al cargar la base de datos.</td></tr>';
    }
}

async function cambiarEstadoEvento(id, nuevoEstado) {
    if (!confirm(`¿Estás seguro de marcar este evento como ${nuevoEstado}?`)) return;
 
    try {
        const res = await fetch(`/api/eventos/${id}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        const data = await res.json();
        if (data.success) cargarEventos();
        else alert('Error al actualizar el estado');
    } catch (error) {
        console.error(error);
        alert('Error de conexión con el servidor');
    }
}