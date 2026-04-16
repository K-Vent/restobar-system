const express = require('express');
const router = express.Router();

const { verificarSesion } = require('../middlewares/auth.middleware');
const { 
    obtenerMesas, 
    abrirMesa, 
    detalleMesa, 
    cerrarMesa, 
    cambiarMesa 
} = require('../controllers/mesas.controller');

router.get('/', verificarSesion, obtenerMesas);
router.post('/abrir/:id', verificarSesion, abrirMesa);
router.get('/detalle/:id', verificarSesion, detalleMesa);
router.post('/cerrar/:id', verificarSesion, cerrarMesa);
router.post('/cambiar', verificarSesion, cambiarMesa);

module.exports = router;