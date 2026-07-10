const express = require('express');
const cors = require('cors');
const dns = require('dns');
require('dotenv').config();

dns.setDefaultResultOrder('ipv4first');

const authRoutes = require('./routes/auth.routes');
const movRoutes = require('./routes/movimientos.routes');
const cuentasRoutes = require('./routes/cuentas.routes');

const app = express();

app.set('trust proxy', 1);

const allowedOrigins = [
  process.env.FRONTEND_URL?.trim(),
  'http://localhost:4200'
].filter(Boolean);

console.log('Orígenes permitidos por CORS:', allowedOrigins);

const corsOptions = {
  origin(origin, callback) {
    /*
     * Permite peticiones sin Origin, por ejemplo:
     * Postman, Thunder Client o llamadas internas.
     */
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.error('Origen bloqueado por CORS:', origin);

    return callback(
      new Error(`El origen ${origin} no está permitido por CORS`)
    );
  },

  credentials: true,

  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS'
  ],

  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept'
  ],

  optionsSuccessStatus: 204
};

// CORS debe colocarse antes de las rutas.
app.use(cors(corsOptions));

// Responde explícitamente a todas las solicitudes preflight OPTIONS.
// La expresión regular funciona tanto con Express 4 como con Express 5.
// app.options(/.*/, cors(corsOptions));

app.use(express.json());

// Ruta para comprobar que el backend está funcionando.
app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'API de Monetra funcionando'
  });
});

// Rutas de la API.
app.use('/api/auth', authRoutes);
app.use('/api/movimientos', movRoutes);
app.use('/api/cuentas', cuentasRoutes);

// Ruta no encontrada.
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: 'Ruta no encontrada',
    method: req.method,
    path: req.originalUrl
  });
});

// Manejador general de errores.
app.use((error, req, res, next) => {
  console.error('Error del servidor:', error);

  res.status(500).json({
    ok: false,
    message: error.message || 'Error interno del servidor'
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});