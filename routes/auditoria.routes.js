const express = require('express');
const router = express.Router();
const { verificarSesion } = require('../middlewares/auth.middleware');
const { obtenerRegistrosAuditoria } = require('../controllers/auditoria.controller');

// Ruta protegida: solo los que han iniciado sesión (y preferiblemente solo admin) pueden ver esto
router.get('/', verificarSesion, obtenerRegistrosAuditoria);

module.exports = router;