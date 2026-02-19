/* ============================================================
   SERVICE WORKER - LA ESQUINA DEL BILLAR
   Estrategia: Network First (Prioriza red, Respaldo en Caché)
   ============================================================ */

const CACHE_NAME = 'la-esquina-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/css/dashboard.css',
    '/js/dashboard.js',
    '/logo.png'
];

// 1. Instalar y guardar la interfaz en la memoria del celular
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => {
            console.log('📦 Interfaz guardada en caché local');
            return cache.addAll(urlsToCache);
        })
    );
});

// 2. Interceptar las peticiones de red (El escudo anti-caídas)
self.addEventListener('fetch', event => {
    // Si la petición es hacia la API (Dinero, Cobros, Base de datos), NO usamos caché
    // Esto garantiza que los números de caja siempre sean reales y exactos
    if (event.request.url.includes('/api/')) {
        return; 
    }
    
    // Para la vista (HTML, CSS, Logos): Intenta descargar de internet. 
    // Si el internet se cae, saca la vista de la memoria del celular.
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});