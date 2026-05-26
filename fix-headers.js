const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'private');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html') && f !== 'dashboard.html');

const icons = {
    'auditoria.html': 'shield-alert',
    'cierre_caja.html': 'lock',
    'clientes.html': 'users',
    'cocina.html': 'chef-hat',
    'empleados.html': 'briefcase',
    'inventario.html': 'package',
    'reportes.html': 'bar-chart-3'
};

files.forEach(file => {
    let content = fs.readFileSync(path.join(dir, file), 'utf8');
    
    // Replace the ugly h4 header that has leftover invisible emoji chars
    const h4Regex = /<h4 class="fw-bold mb-0 text-white".*?>.*?<\/h4>/;
    
    // Extract the text content, strip out any non-ascii characters
    const match = content.match(h4Regex);
    if(match) {
        let text = match[0].replace(/<[^>]+>/g, '').replace(/[^\x00-\x7F]/g, '').trim();
        const icon = icons[file] || 'layout-grid';
        
        const newH4 = `<h4 class="fw-bold mb-0 text-white" style="letter-spacing: 1px; display:flex; align-items:center; gap:8px;"><i data-lucide="${icon}" style="color: var(--gold);"></i> ${text}</h4>`;
        
        content = content.replace(h4Regex, newH4);
        fs.writeFileSync(path.join(dir, file), content);
    }
});

console.log("Headers updated with A1 Lucide icons.");
