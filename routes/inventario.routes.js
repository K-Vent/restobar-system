const express = require('express');
const router = express.Router();

// Reutilizamos el escudo de seguridad que creaste en el paso anterior
const { verificarSesion, soloAdmin } = require('../middlewares/auth.middleware');
const { obtenerProductos, crearProducto, eliminarProducto } = require('../controllers/inventario.controller');

// Mapeo de URLs
router.get('/', verificarSesion, obtenerProductos);
router.post('/nuevo', verificarSesion, soloAdmin, crearProducto);
router.delete('/eliminar/:id', verificarSesion, soloAdmin, eliminarProducto);

module.exports = router;