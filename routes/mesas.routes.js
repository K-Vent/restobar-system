const express = require('express');
const router = express.Router();

const { verificarSesion, soloAdmin } = require('../middlewares/auth.middleware');
const { 
    obtenerMesas, 
    abrirMesa, 
    detalleMesa, 
    cerrarMesa, 
    cambiarMesa,
    crearMesa, 
    eliminarUltimaMesa,
    cerrarCuentaPersonal // 1. SE IMPORTA LA NUEVA FUNCIÓN AQUÍ
} = require('../controllers/mesas.controller');

router.get('/',                  verificarSesion,             obtenerMesas);
router.post('/abrir/:id',        verificarSesion,             abrirMesa);
router.get('/detalle/:id',       verificarSesion,             detalleMesa);
router.post('/cerrar/:id',       verificarSesion,             cerrarMesa);
router.post('/cambiar',          verificarSesion,             cambiarMesa);

// 2. GESTIÓN DE CUENTAS DIVIDIDAS (Se coloca junto a los flujos de cierre)
router.post('/cerrar-personal/:id', verificarSesion,          cerrarCuentaPersonal);

// 🔒 CORREGIDO: estas dos rutas estaban sin protección — cualquiera podía crear o borrar mesas
router.post('/crear',            verificarSesion, soloAdmin,  crearMesa);
router.delete('/eliminar-ultima',verificarSesion, soloAdmin,  eliminarUltimaMesa);

module.exports = router;