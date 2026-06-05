const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const movRoutes = require('./routes/movimientos.routes');

const app = express();

app.set('trust proxy', 1);

// CONFIGURACIÓN DE CORS REFORZADA
const corsOptions = {
  origin: 'https://monetra-eosin.vercel.app', // Tu dominio de Vercel
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Por si en el futuro manejas cookies/sesiones
};

app.use(cors(corsOptions));

// Responder automáticamente 200 OK a las peticiones Preflight (OPTIONS)
app.options('*', cors(corsOptions)); 

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/movimientos', movRoutes);

// Asegúrate de haber corregido esto también para que Railway no apague tu contenedor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Servidor corriendo en puerto', PORT);
});
