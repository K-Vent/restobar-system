const fs = require('fs');
const path = require('path');

const privateDir = path.join(__dirname, 'private');
const files = fs.readdirSync(privateDir).filter(f => f.endsWith('.html') && f !== 'dashboard.html');

const newSidebar = `
    <!-- Corporate Sidebar -->
    <nav class="sidebar">
        <div class="text-center mb-5 mt-2">
            <img src="/logo.png" class="brand-logo" style="max-width: 120px;" alt="La Esquina">
        </div>
        
        <button class="btn btn-warning fw-bold mb-4 py-2 w-100 d-flex justify-content-center align-items-center gap-2" style="font-size: 13px;" onclick="document.getElementById('modal-gasto') ? document.getElementById('modal-gasto').style.display='flex' : alert('Gasto no disponible aquí')">
            <i data-lucide="receipt"></i> REGISTRAR GASTO
        </button>
        
        <div class="d-flex flex-column flex-grow-1">
            <a href="/dashboard.html" class="nav-item-vip"><i data-lucide="layout-grid"></i> Control de Mesas</a>
            <a href="/cocina.html" class="nav-item-vip" target="_blank"><i data-lucide="chef-hat"></i> Pantalla Cocina</a>
            <a href="/inventario.html" class="nav-item-vip"><i data-lucide="package"></i> Inventario</a>
            <a href="/clientes.html" class="nav-item-vip"><i data-lucide="users"></i> Clientes VIP</a>
            <a href="/reportes.html" class="nav-item-vip"><i data-lucide="bar-chart-3"></i> Reportes (BI)</a>
            <a href="/cierre_caja.html" class="nav-item-vip"><i data-lucide="lock"></i> Cerrar Caja</a>
            <a href="/auditoria.html" class="nav-item-vip" style="color: #ef4444;"><i data-lucide="shield-alert"></i> Auditoría</a>
            <a href="/empleados.html" class="nav-item-vip"><i data-lucide="briefcase"></i> Empleados</a>
        </div>
        
        <a href="/logout" class="btn-logout-sidebar mt-4">
            <i data-lucide="log-out"></i> CERRAR SESIÓN
        </a>
    </nav>
`;

// Also need to add the Lucide script to the head of each file if not present
const lucideScript = `<script src="https://unpkg.com/lucide@latest"></script>`;
const lucideInit = `<script>
        document.addEventListener("DOMContentLoaded", () => {
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
    </script>
</body>`;

files.forEach(file => {
    let content = fs.readFileSync(path.join(privateDir, file), 'utf8');
    
    // Replace sidebar
    content = content.replace(/<nav class="sidebar">[\s\S]*?<\/nav>/, newSidebar.trim());
    
    // Add lucide script
    if (!content.includes('lucide@latest')) {
        content = content.replace('</head>', `    ${lucideScript}\n</head>`);
    }
    if (!content.includes('lucide.createIcons()')) {
        content = content.replace('</body>', `${lucideInit}`);
    }

    // Set active class based on file name
    const regex = new RegExp(`href="/${file}" class="nav-item-vip"`, 'g');
    content = content.replace(regex, `href="/${file}" class="nav-item-vip active"`);

    fs.writeFileSync(path.join(privateDir, file), content);
});

console.log('Sidebars updated in all private files.');
