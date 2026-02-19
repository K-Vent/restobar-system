const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    // Creamos la ventana principal de Windows/Mac
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 768,
        title: "La Esquina del Billar - Sistema POS",
        icon: path.join(__dirname, 'public', 'logo.png'), // Tu logo en la barra de tareas
        autoHideMenuBar: true, // Oculta el menú feo de "Archivo, Editar, Ver..."
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Maximizamos la ventana para que ocupe toda la pantalla del cajero
    mainWindow.maximize();

    // [MUY IMPORTANTE] Cargamos tu sistema desde la nube (Render)
    // Así los datos del celular y de la PC estarán siempre sincronizados.
    mainWindow.loadURL('https://la-esquina-app.onrender.com/dashboard.html');

    // Si la página no carga (no hay internet), mostramos un error
    mainWindow.webContents.on('did-fail-load', () => {
        mainWindow.loadFile(path.join(__dirname, 'public', 'error.html')); // Opcional
        console.log("Error de conexión a Internet");
    });

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

// Cuando Electron esté listo, abrimos la ventana
app.whenReady().then(createWindow);

// Cerrar el proceso cuando se cierran todas las ventanas
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});