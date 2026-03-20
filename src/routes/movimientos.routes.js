const express = require('express');
const pool = require('../db');
const verifyToken = require('../middleware/auth.middleware');

const router = express.Router();

// Crear movimiento
router.post('/', verifyToken, async (req, res) => {
    const id_usuario = req.user.id;

    try {
        const { categoria, descripcion, fecha, monto, tipoMovimiento } = req.body;

        await pool.query(
            `INSERT INTO movimientos 
            (id_usuario, id_tipo_movimiento, id_categoria, monto, descripcion, fecha) 
            VALUES ($1,$2,$3,$4,$5,$6)`,
            [id_usuario, tipoMovimiento, categoria, monto, descripcion, fecha]
        );

        res.json({ message: 'Movimiento Registrado' });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Error al registrar movimiento'
        });
    }
});

module.exports = router;
