const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const movRoutes = require('./routes/movimientos.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/movimientos', movRoutes);

app.listen(process.env.PORT, () => {
  console.log('Servidor corriendo en puerto', process.env.PORT);
});
