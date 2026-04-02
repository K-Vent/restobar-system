const express = require('express');
const router = express.Router();

const { verificarSesion, soloAdmin } = require('../middlewares/auth.middleware');
const { obtenerUsuarios, crearUsuario, eliminarUsuario } = require('../controllers/usuarios.controller');

// Mira lo limpias que quedan las URLs
router.get('/', verificarSesion, soloAdmin, obtenerUsuarios);
router.post('/nuevo', verificarSesion, soloAdmin, crearUsuario);
router.delete('/eliminar/:id', verificarSesion, soloAdmin, eliminarUsuario);

module.exports = router;