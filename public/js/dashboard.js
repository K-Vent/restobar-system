
// ==========================================
// ESTADO GLOBAL DEL SISTEMA
// ==========================================
let mesaActivaParaCobro = null; // Memoria para saber qué mesa está abierta en la caja

// ... (aquí abajo siguen tus otras variables que ya tenías, como let mesas = [], etc.)

/* ============================================================
   DASHBOARD.JS - SISTEMA GESTIÓN "LA ESQUINA DEL BILLAR"
   Versión: Premium POS / Alertas Dinámicas / Mudanzas
   ============================================================ */

const socket = io(); 
let intervaloCronometros = null;
let mesaAccionId = null; 
let mesaOrigenMoveId = null; // Variable para mudanzas
let usuarioActual = null;
let totalDeudaCobro = 0; 
let productosDisponibles = [];
let filtroActual = 'TODAS';
let todasLasMesas = [];

// ==========================================
// 1. INICIALIZACIÓN
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    await verificarRol();
    await cargarMesas();
    await cargarProductosMenu();
    if(usuarioActual && usuarioActual.rol === 'admin') cargarCaja();
});

socket.on('actualizar_mesas', () => cargarMesas());
socket.on('actualizar_caja', () => { 
    if(usuarioActual && usuarioActual.rol === 'admin') cargarCaja(); 
});



// ==========================================
// 3. SEGURIDAD Y CARGAS INICIALES
// ==========================================
async function verificarRol() {
    try {
        const res = await fetch('/api/usuario/actual');
        usuarioActual = await res.json();
        if (usuarioActual.rol !== 'admin') {
            document.querySelectorAll('.menu-link').forEach(link => {
                const txt = link.innerText.toLowerCase();
                if (txt.includes('inventario') || txt.includes('historial') || txt.includes('cerrar caja') || txt.includes('empleados')) link.style.display = 'none';
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
// 4. RENDERIZADO DE MESAS Y TIEMPO
// ==========================================
async function cargarMesas() {
    try {
        const res = await fetch('/api/mesas');
        todasLasMesas = await res.json();
        filtrarMesas(); // Llamamos al filtro en lugar de renderizar directo
    } catch (error) { console.error("Error al cargar mesas:", error); }
}

function setFiltro(tipo, btn) {
    filtroActual = tipo;
    // Cambiar estilo de botones
    document.querySelectorAll('.btn-group .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filtrarMesas();
}

function filtrarMesas() {
    const inputBusqueda = document.getElementById('busqueda-mesa');
    // Si el buscador no existe aún en el HTML, no hacemos nada para evitar errores
    if (!inputBusqueda) return; 
    
    const busqueda = inputBusqueda.value.toLowerCase();
    
    const filtradas = todasLasMesas.filter(m => {
        const cumpleTipo = filtroActual === 'TODAS' || 
                           (filtroActual === 'OCUPADA' && m.estado === 'OCUPADA') ||
                           (filtroActual === 'BILLAR' && m.tipo === 'BILLAR');
        
        // Blindamos el número de mesa por si viene vacío desde la base de datos
        const numeroSeguro = String(m.numero_mesa || '').toLowerCase();
        const cumpleBusqueda = numeroSeguro.includes(busqueda);
        
        return cumpleTipo && cumpleBusqueda;
    });

    renderizarMesas(filtradas);
}

// Versión V5 - Dark Premium Absoluto
function renderizarMesas(mesas) {
    const grid = document.getElementById('grid-mesas');
    if (!grid) return; 
    
    grid.innerHTML = '';
    grid.className = 'row g-3'; 
    clearInterval(intervaloCronometros);

    mesas.forEach(mesa => {
        const isOcupada = mesa.estado === 'OCUPADA';
        
        // ✨ ADIÓS A LOS GRISES DE BOOTSTRAP ✨
        const claseTarjeta = isOcupada ? 'card-mesa card-mesa-ocupada' : 'card-mesa card-mesa-libre';
        const statusBadge = isOcupada ? 'bg-warning text-dark fw-bold' : 'bg-dark border border-secondary text-muted';
        const icono = mesa.tipo === 'BILLAR' ? '🎱' : '🛒';

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
                                <div class="col-6"><button class="btn btn-warning fw-bold w-100 py-2 shadow-sm" onclick="abrirOpciones(${mesa.id})">🍺 PEDIR</button></div>
                                <div class="col-6"><button class="btn btn-light fw-bold text-dark w-100 py-2 shadow-sm" onclick="abrirModalCobro(${mesa.id})">💰 COBRAR</button></div>
                            </div>
                            <button class="btn btn-dark border-secondary btn-sm text-light mt-1" onclick="abrirModalMover(${mesa.id})">🔄 MUDAR</button>
                        </div>
                    ` : `
                        <div class="text-center py-4 flex-grow-1 d-flex flex-column justify-content-center">
                            <p class="small text-muted mb-0 fw-bold" style="letter-spacing: 1px;">TARIFA BASE</p>
                            <p class="fs-5 text-white opacity-50 mb-0">S/ ${parseFloat(mesa.precio_hora || 0).toFixed(2)} / hr</p>
                        </div>
                        <div class="mt-auto">
                            <button class="btn btn-iniciar-mesa w-100 fw-bold py-3 text-uppercase" onclick="abrirMesa(${mesa.id})">
                                ▶ Iniciar Mesa
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
// 5. ACCIONES DE MUDANZA (NUEVO)
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
            select.innerHTML += `<option value="${m.id}">${m.tipo === 'BILLAR' ? '🎱' : '🛒'} Mesa ${m.numero_mesa}</option>`;
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
            mostrarToast("🔄 Mudanza realizada con éxito");
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
    if(productosDisponibles.length === 0) cargarProductosMenu(); 
    renderizarProductosMesa(productosDisponibles);
    document.getElementById('modal-pedidos').style.display = 'flex';
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

    if (cantidadSeleccionada <= 0) return mostrarAlerta("La cantidad debe ser mayor a 0");

    try {
        const res = await fetch('/api/pedidos/agregar', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ mesa_id: mesaAccionId, producto_id: productoId, cantidad: cantidadSeleccionada })
        });
        if (res.ok) {
            mostrarToast(`✅ ${cantidadSeleccionada}x añadido(s)`);
            await cargarProductosMenu(); 
            abrirOpciones(mesaAccionId); 
        } else {
            mostrarAlerta("Error al añadir producto (¿Revisaste si hay stock suficiente?)");
        }
    } catch (e) { mostrarAlerta("Error de red al añadir producto."); }
}

async function eliminarPedido(idPedido, idMesa) {
    try {
        // Llamamos al nuevo modal global asíncrono
        const confirmado = await mostrarConfirmacion("⚠️ Retirar Producto", "¿Seguro que quieres quitar este producto de la cuenta? El stock regresará a tu inventario.");
        
        if (confirmado) {
            const res = await fetch(`/api/pedidos/eliminar/${idPedido}`, { method: 'DELETE' });
            if (res.ok) {
                mostrarToast("🗑️ Producto retirado de la cuenta");
                abrirModalCobro(idMesa); // Esto actualiza la lista y el total de la mesa al instante
            } else {
                mostrarAlerta("Error en el servidor al intentar eliminar.", "error");
            }
        }
    } catch (error) {
        console.error("Error en eliminarPedido:", error);
        mostrarAlerta("No se pudo cargar la confirmación. Revisa la consola.", "error");
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
            data.listaProductos.forEach(p => {
                listaHtml += `
                    <div class="d-flex justify-content-between align-items-center border-bottom border-secondary py-2">
                        <div class="text-white fw-bold">
                            <span class="text-warning me-2">${p.cantidad}x</span> ${p.nombre}
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <span class="text-success fw-bold">S/ ${parseFloat(p.subtotal).toFixed(2)}</span>
                            <button class="btn btn-outline-danger btn-sm" onclick="eliminarPedido(${p.id}, ${id})" title="Quitar de la cuenta">🗑️</button>
                        </div>
                    </div>
                `;
            });
        } else {
            listaHtml = '<div class="text-muted text-center py-3 small">No hay consumo registrado</div>';
        }

        let html = `
            <div class="bg-black p-3 rounded mb-3 border border-secondary shadow-sm">
                <div class="d-flex justify-content-between mb-3 text-muted border-bottom border-secondary pb-2">
                    <span class="fw-bold">⏳ Tiempo Jugado (${data.minutos} min):</span>
                    <span class="text-warning fw-bold fs-5">S/ ${data.totalTiempo.toFixed(2)}</span>
                </div>
                
                <div class="text-muted small text-uppercase fw-bold mb-2">🍺 Detalle de Consumo:</div>
                <div style="max-height: 180px; overflow-y: auto;" class="pe-1">
                    ${listaHtml}
                </div>
            </div>
            
            <div class="text-center fw-bold text-white mb-4">
                <span class="fs-4">TOTAL:</span> 
                <span class="fs-1 text-warning d-block" style="text-shadow: 0 0 15px rgba(241,196,15,0.4);">S/ ${totalDeudaCobro.toFixed(2)}</span>
            </div>

            <button class="btn btn-warning w-100 fw-bold py-3 shadow-sm fs-6" onclick="abrirScanner()">
                📸 ESCANEAR SOCIO VIP (+1 Sello)
            </button>
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
            return mostrarAlerta("Los montos no cuadran con el total exacto.");
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
            mostrarToast("💳 Cobro Registrado y Finalizado");
        } else {
            mostrarAlerta("Error en el servidor al intentar cobrar.");
        }
    } catch (e) { mostrarAlerta("Error de conexión al cobrar."); }
}

// ==========================================
// 8. GASTOS Y UTILIDADES
// ==========================================
async function ejecutarGasto() {
    const desc = document.getElementById('gasto-desc').value;
    const monto = document.getElementById('gasto-monto').value;
    if (!desc || !monto) return mostrarAlerta("Por favor, llena todos los campos del gasto.");

    await fetch('/api/gastos/nuevo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descripcion: desc, monto: parseFloat(monto) })
    });
    
    cerrarModal('modal-gasto');
    document.getElementById('gasto-desc').value = '';
    document.getElementById('gasto-monto').value = '';
    mostrarToast("💸 Gasto Registrado Correctamente");
}

function cerrarModal(id) { document.getElementById(id).style.display = 'none'; }
function mostrarToast(msg) { 
    const t = document.getElementById("toast"); 
    t.innerText = msg; t.className = "show"; 
    setTimeout(() => t.className = t.className.replace("show",""), 2500); 
}

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

// ==========================================
// MÓDULO DE ESCÁNER QR Y CÁMARA
// ==========================================
let escanerActivo = null;

function abrirScanner() {
    // 1. Mostramos la ventana negra
    document.getElementById('modal-scanner').style.display = 'flex';
    
    // 2. Encendemos la cámara con la librería
    escanerActivo = new Html5QrcodeScanner(
        "reader", 
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 }, 
        false
    );
    
    // 3. Le decimos qué hacer si lee un código o si falla
    escanerActivo.render(escaneoExitoso, escaneoFallido);
}

function cerrarScanner() {
    // Apagamos la cámara para que no gaste batería
    if (escanerActivo) {
        escanerActivo.clear(); 
    }
    document.getElementById('modal-scanner').style.display = 'none';
}

function escaneoFallido(error) {
    // Esta función debe existir para que la librería no de errores mientras busca un QR.
    // La dejamos vacía para que trabaje en silencio.
}

async function escaneoExitoso(textoDecodificado) {
    cerrarScanner(); // Apagamos la cámara de inmediato
    
    try {
        // 1. Consultamos a la base de datos quién es el dueño del QR
        const res = await fetch(`/api/vip/escanear/${textoDecodificado}`);
        const data = await res.json();
        
        if (!res.ok) return mostrarAlerta(data.error, "error");

        // 2. Sumamos su sello de visita por haber venido hoy (En segundo plano)
        fetch(`/api/clientes/${data.id}/sello`, { method: 'POST' });

        // 3. Mostramos su Perfil en la Caja (Estilo Agora)
        document.getElementById('vip-nombre-caja').innerText = data.nombre;
        document.getElementById('vip-nivel-caja').innerText = `Socio ${data.nivel}`;
        
        const recompensaDiv = document.getElementById('vip-recompensa-caja');
        const btnContainer = document.getElementById('btn-container-canje');
        
        if (data.premios > 0) {
            recompensaDiv.innerHTML = `<span style="color: #D4AF37; font-weight: 900; font-size: 16px;">🎁 ¡Tiene ${data.premios} Hora(s) Gratis disponible(s)!</span>`;
            btnContainer.innerHTML = `<button class="btn-mesa" style="background: #D4AF37; color: #000; font-weight: 900; width: 100%; padding: 15px;" onclick="ejecutarCanjeAgora(${data.id}, mesaAccionId)">✅ APLICAR PREMIO A ESTA MESA</button>`;
        } else {
            recompensaDiv.innerHTML = `<span style="color: #888; font-size: 14px;">No tiene recompensas disponibles aún.</span><br><span style="color: #25D366; font-weight: bold; font-size: 12px;">+1 Sello añadido por su visita.</span>`;
            btnContainer.innerHTML = ''; // Ocultamos el botón porque no tiene premios
        }

        // Abrimos el Perfil VIP
        document.getElementById('modal-perfil-vip').style.display = 'flex';

    } catch (error) {
        mostrarAlerta("Error al leer la tarjeta VIP.", "error");
    }
}

// 4. La Función Definitiva que Cuadra la Caja y Resta el Premio
async function ejecutarCanjeAgora(idSocio, idMesa) {
    document.getElementById('modal-perfil-vip').style.display = 'none';
    const confirmado = await mostrarConfirmacion("⚠️ CONFIRMACIÓN DE SEGURIDAD", "¿Aplicar el descuento? Esta acción no se puede deshacer.");
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
            mostrarAlerta("🎁 ¡Descuento Agora aplicado! La cuenta ha sido recalculada.", "success");
            
            // Recargamos el sistema para mostrar el nuevo total exacto
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
// Función para los botones + y -
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

// Función para validar cuando el usuario escribe manualmente
function validarManual(id, maxStock) {
    const input = document.getElementById(`cant-${id}`);
    if (!input) return;

    let val = parseInt(input.value);
    
    // Si borra el número, lo dejamos en blanco para que pueda escribir, 
    // pero si pone un número mayor al stock, lo bajamos al máximo.
    if (val > maxStock) {
        input.value = maxStock;
        mostrarToast(`Solo hay ${maxStock} en stock`);
    }
    if (val < 1) input.value = 1;
}

// ==========================================
// CONTROL DE MENÚ EN DISPOSITIVOS MÓVILES
// ==========================================
function abrirMenuMovil() {
    document.querySelector('.sidebar').classList.add('abierto-movil');
    document.getElementById('overlay-sidebar').classList.add('activo');
}

function cerrarMenuMovil() {
    document.querySelector('.sidebar').classList.remove('abierto-movil');
    document.getElementById('overlay-sidebar').classList.remove('activo');
}