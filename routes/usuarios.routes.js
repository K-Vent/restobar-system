const express = require('express');
const router = express.Router();

const { verificarSesion, soloAdmin } = require('../middlewares/auth.middleware');
const { obtenerUsuarios, crearUsuario, eliminarUsuario } = require('../controllers/usuarios.controller');

// 🔒 CORREGIDO: las rutas ahora usan convención REST estándar
// El frontend en empleados.html llama:
//   GET    /api/usuarios        → obtener lista
//   POST   /api/usuarios        → crear usuario   (antes era /api/usuarios/nuevo — no coincidía)
//   DELETE /api/usuarios/:id    → eliminar         (antes era /api/usuarios/eliminar/:id — no coincidía)

router.get('/',    verificarSesion, soloAdmin, obtenerUsuarios);
router.post('/',   verificarSesion, soloAdmin, crearUsuario);
router.delete('/:id', verificarSesion, soloAdmin, eliminarUsuario);

module.exports = router;