const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'llave_maestra_billar_2026'; 

const verificarSesion = (req, res, next) => { 
    const token = req.cookies.token; 
    if (!token) { 
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autorizado.' }); 
        return res.redirect('/'); 
    } 
    try { 
        const decoded = jwt.verify(token, SECRET_KEY); 
        req.usuario = decoded; 
        next(); 
    } catch (e) { 
        res.clearCookie('token');
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesión expirada.' }); 
        res.redirect('/'); 
    } 
};

const soloAdmin = (req, res, next) => { 
    if (req.usuario && req.usuario.rol === 'admin') return next(); 
    res.status(403).json({ error: '⛔ Acceso Denegado.' }); 
};

module.exports = { verificarSesion, soloAdmin };