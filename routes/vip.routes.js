const express = require('express');
const router = express.Router();
const { verificarSesion } = require('../middlewares/auth.middleware');

const { 
    obtenerClientes, registrarCliente, loginVip, agregarSello, 
    canjearPremio, escanearQr, canjeSeguroTransaccion, 
    obtenerBeneficios, agregarBeneficio, eliminarBeneficio 
} = require('../controllers/vip.controller');

// --- RUTAS DE CLIENTES ---
router.get('/clientes', verificarSesion, obtenerClientes);
router.post('/clientes/nuevo', verificarSesion, registrarCliente);
router.post('/clientes/:id/sello', verificarSesion, agregarSello);
router.post('/clientes/:id/canjear', verificarSesion, canjearPremio);

// --- RUTAS DE LOGEO Y QR (VIP) ---
router.post('/vip/login', loginVip); // Público (lo usa el cliente en su celular)
router.get('/vip/escanear/:codigo', verificarSesion, escanearQr);

// --- RUTA DE TRANSACCIÓN SEGURA ---
router.post('/transaccion/canje-seguro', verificarSesion, canjeSeguroTransaccion);

// --- RUTAS DE BENEFICIOS ---
router.get('/beneficios', obtenerBeneficios); // Público
router.post('/beneficios', verificarSesion, agregarBeneficio);
router.delete('/beneficios/:id', verificarSesion, eliminarBeneficio);

module.exports = router;