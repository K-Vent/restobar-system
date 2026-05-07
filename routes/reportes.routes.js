const express = require('express');
const router = express.Router();
const { verificarSesion, soloAdmin } = require('../middlewares/auth.middleware');
const { 
    getDashboardStats, 
    getHistorialCierres, 
    eliminarCierre 
} = require('../controllers/reportes.controller');

// 🔒 Todas estas rutas están fuertemente protegidas. Solo administradores pueden ver métricas.
router.get('/analytics/dashboard', verificarSesion, soloAdmin, getDashboardStats);
router.get('/reportes/historial', verificarSesion, soloAdmin, getHistorialCierres);
router.delete('/reportes/eliminar/:id', verificarSesion, soloAdmin, eliminarCierre);

module.exports = router;