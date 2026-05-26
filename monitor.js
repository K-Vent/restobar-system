const axios = require('axios'); // Asegúrate de tener axios instalado ('npm install axios')

// 1. PEGA EL TOKEN QUE COPIASTE DE PROYECT-TI AQUÍ:
const TOKEN_MONITOREO = "3e6f1b7d-00c2-4cdd-9fa3-20bb7aeaf930";
const BACKEND_URL = "http://localhost:3000/api/telemetria/heartbeat";

console.log("🚀 Sensor de telemetría de Proyect-TI enlazado a la App de Billar...");

setInterval(async () => {
  const inicio = Date.now();
  try {
    // Aquí puedes simular o verificar si tu base de datos de billar está activa
    const estado = "OPERACIONAL"; 
    const latencia = Date.now() - inicio;

    await axios.post(BACKEND_URL, {
      token_monitoreo: TOKEN_MONITOREO,
      latencia: latencia,
      estado: estado
    });
    console.log(`[SLA Billar] Latido enviado: ${latencia}ms | ${estado}`);
  } catch (error) {
    console.error("[SLA Billar] Servidor Proyect-TI no disponible.");
  }
}, 10000); // Latido cada 10 segundos