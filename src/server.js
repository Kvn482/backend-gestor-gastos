const express = require('express');
const cors = require('cors');
const dns = require('dns');
require('dotenv').config();

// 1. Forzar a Node.js a priorizar IPv4 (Soluciona el error ENETUNREACH al enviar correos)
dns.setDefaultResultOrder('ipv4first');

const authRoutes = require('./routes/auth.routes');
const movRoutes = require('./routes/movimientos.routes');
const cuentasRoutes = require('./routes/cuentas.routes');

const app = express();

// 2. Confiar en el proxy de Railway/Docker (Soluciona el ValidationError de express-rate-limit)
app.set('trust proxy', 1);

// 3. Configuración de CORS dinámica usando tu variable de entorno de Railway
const corsOptions = {
  origin: process.env.FRONTEND_URL, 
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};

app.use(cors(corsOptions));
app.use(express.json());

// 4. Rutas de tu API
app.use('/api/auth', authRoutes);
app.use('/api/movimientos', movRoutes);
app.use('/api/cuentas', cuentasRoutes);

// 5. Inicialización del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Servidor corriendo en puerto', PORT);
});