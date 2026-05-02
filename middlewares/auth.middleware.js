const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'llave_maestra_billar_2026';

// 1. Guardia de Sesión (Verifica si alguien hizo login)
const verificarSesion = (req, res, next) => {
    const token = req.cookies.token;
    
    if (!token) {
        if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'No autorizado' });
        return res.redirect('/'); // Lo devuelve al login
    }
    
    try {
        const decodificado = jwt.verify(token, SECRET_KEY);
        req.usuario = decodificado; // Guarda { id, username, rol }
        next();
    } catch (error) {
        res.clearCookie('token');
        if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Token inválido' });
        return res.redirect('/');
    }
};

// 2. Guardia de Gerencia (Solo Administradores)
const soloAdmin = (req, res, next) => {
    if (req.usuario && req.usuario.rol === 'admin') {
        next(); // Es jefe, puede pasar
    } else {
        console.warn(`⚠️ Intento de acceso denegado: ${req.usuario.username} intentó entrar a ${req.originalUrl}`);
        
        // Si es una petición de datos (API)
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(403).json({ error: 'Acceso denegado: Área exclusiva de Gerencia.' });
        }
        // Si intentó entrar escribiendo la página en el navegador, lo devolvemos a sus mesas
        res.redirect('/dashboard.html'); 
    }
};

module.exports = { verificarSesion, soloAdmin };