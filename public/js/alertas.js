/* ============================================================
   CONTROLADOR GLOBAL DE UI (Reemplazo de alert y confirm)
   ============================================================ */

window.mostrarAlerta = function(mensaje, tipo = 'info') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '9999';
    
    let colorStr = 'var(--gold)';
    let titleStr = '⚠️ Atención';
    
    if(tipo === 'error') { colorStr = 'var(--danger)'; titleStr = '❌ Error'; }
    if(tipo === 'success') { colorStr = 'var(--success)'; titleStr = '✅ Éxito'; }

    overlay.innerHTML = `
        <div class="modal-box" style="max-width: 350px; animation: popIn 0.3s ease-out;">
            <div class="modal-title" style="background: #111; color: ${colorStr}; border-bottom: 1px solid var(--border);">${titleStr}</div>
            <div class="modal-body" style="text-align:center; padding: 30px 20px; font-size: 16px; color: white;">
                ${mensaje}
            </div>
            <div class="modal-btns">
                <button class="btn-modal btn-confirm" style="width:100%; background: ${colorStr}; color: #000;" onclick="this.closest('.modal-overlay').remove()">ENTENDIDO</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};

window.mostrarConfirmacion = function(titulo, mensaje) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '9999';
        
        overlay.innerHTML = `
            <div class="modal-box" style="max-width: 400px; animation: popIn 0.3s ease-out;">
                <div class="modal-title" style="background: #111; color: var(--danger); border-bottom: 1px solid var(--border);">${titulo}</div>
                <div class="modal-body" style="text-align:center; padding: 30px 20px; font-size: 16px; color: #ccc;">
                    ${mensaje}
                </div>
                <div class="modal-btns">
                    <button class="btn-modal btn-cancel" id="dyn-cancel">Cancelar</button>
                    <button class="btn-modal" id="dyn-confirm" style="background: var(--danger); color: white;">CONFIRMAR</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        document.getElementById('dyn-cancel').onclick = () => {
            overlay.remove();
            resolve(false);
        };
        
        document.getElementById('dyn-confirm').onclick = () => {
            overlay.remove();
            resolve(true);
        };
    });
};