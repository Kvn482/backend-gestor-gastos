const express = require('express');
const pool = require('../db');
const verifyToken = require('../middleware/auth.middleware');
const {
    getMovimientosRapidos,
    createOrUpsertMovimientoRapido,
    updateMovimientoRapido,
    deleteMovimientoRapido
} = require('../services/movimientos-rapidos.service');

const router = express.Router();

// GET /api/movimientos-rapidos
router.get('/', verifyToken, async (req, res) => {
    try {
        const id_usuario = req.user.id;
        const movimientos = await getMovimientosRapidos(pool, id_usuario);
        res.status(200).json(movimientos);
    } catch (error) {
        console.error('Error al obtener movimientos rápidos:', error);
        res.status(500).json({
            message: 'Error al consultar movimientos rápidos'
        });
    }
});

// POST /api/movimientos-rapidos
router.post('/', verifyToken, async (req, res) => {
    try {
        const id_usuario = req.user.id;
        const nuevo = await createOrUpsertMovimientoRapido(pool, id_usuario, req.body);
        res.status(201).json({
            message: 'Movimiento rápido guardado con éxito',
            data: nuevo
        });
    } catch (error) {
        console.error('Error al guardar movimiento rápido:', error);
        res.status(400).json({
            message: error.message || 'Error al guardar movimiento rápido'
        });
    }
});

// PUT /api/movimientos-rapidos/:id
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const id_usuario = req.user.id;
        const { id } = req.params;
        const actualizado = await updateMovimientoRapido(pool, id_usuario, id, req.body);

        if (!actualizado) {
            return res.status(404).json({
                message: 'Movimiento rápido no encontrado'
            });
        }

        res.status(200).json({
            message: 'Movimiento rápido actualizado',
            data: actualizado
        });
    } catch (error) {
        console.error('Error al actualizar movimiento rápido:', error);
        res.status(400).json({
            message: error.message || 'Error al actualizar movimiento rápido'
        });
    }
});

// DELETE /api/movimientos-rapidos/:id
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const id_usuario = req.user.id;
        const { id } = req.params;
        const eliminado = await deleteMovimientoRapido(pool, id_usuario, id);

        if (!eliminado) {
            return res.status(404).json({
                message: 'Movimiento rápido no encontrado'
            });
        }

        res.status(200).json({
            message: 'Movimiento rápido eliminado'
        });
    } catch (error) {
        console.error('Error al eliminar movimiento rápido:', error);
        res.status(500).json({
            message: 'Error al eliminar movimiento rápido'
        });
    }
});

module.exports = router;

