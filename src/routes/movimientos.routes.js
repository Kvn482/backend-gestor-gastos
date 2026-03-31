const express = require('express')
const pool = require('../db')
const verifyToken = require('../middleware/auth.middleware')

const router = express.Router()

// Crear movimiento
router.post('/', verifyToken, async (req, res) => {
    const id_usuario = req.user.id

    try {
        const { categoria, descripcion, fecha, monto, tipoMovimiento } = req.body

        await pool.query(
            `INSERT INTO movimientos 
            (id_usuario, id_tipo_movimiento, id_categoria, monto, descripcion, fecha) 
            VALUES ($1,$2,$3,$4,$5,$6)`,
            [id_usuario, tipoMovimiento, categoria, monto, descripcion, fecha]
        )

        res.status(201).json({ message: 'Movimiento Registrado' })

    } catch (error) {
        console.error(error)
        res.status(500).json({
            message: 'Error al registrar movimiento'
        })
    }
})

// Consultar balance general, egresos, ingresos
router.get('/balance-general', verifyToken, async (req, res) => {
    const id_usuario = req.user.id

    try {
        const result = await pool.query(
            `SELECT 
                COALESCE(SUM(CASE WHEN id_tipo_movimiento = 1 THEN monto ELSE 0 END), 0) AS ingresos,
                COALESCE(SUM(CASE WHEN id_tipo_movimiento = 2 THEN monto ELSE 0 END), 0) AS egresos,
                COALESCE(SUM(
                    CASE 
                    WHEN id_tipo_movimiento = 1 THEN monto 
                    ELSE -monto 
                    END
                ), 0) AS balance
                FROM movimientos
                WHERE id_usuario = $1
                AND fecha <= CURRENT_DATE
            `,
            [id_usuario]
        )

        const data = result.rows[0]

        res.status(200).json({
            ingresos: Number(data.ingresos),
            egresos: Number(data.egresos),
            balance: Number(data.balance)
        })

    } catch (error) {
        console.error(error)
        res.status(500).json({
            message: 'Error al registrar movimiento'
        })
    }
})

// Consultar categorías disponibles para el usuario
router.get('/categorias', verifyToken, async (req, res) => {
    const id_usuario = req.user.id

    try {
        const result = await pool.query(
            `SELECT id, nombre AS categoria, id_usuario 
                FROM categorias
                WHERE status = 1 AND (id_usuario IS NULL OR id_usuario = $1)
            `,
            [id_usuario]
        )

        const data = result.rows

        res.status(200).json(data)

    } catch (error) {
        console.error(error)
        res.status(500).json({
            message: 'Error al consultar categorías'
        })
    }
})

// Consultar tipos de movimiento
router.get('/tipos-movimiento', verifyToken, async (req, res) => {

    try {
        const result = await pool.query(
            `SELECT id, nombre AS movimiento 
                FROM tipos_movimiento
                WHERE status = 1
            `
        )

        const data = result.rows

        res.status(200).json(data)

    } catch (error) {
        console.error(error)
        res.status(500).json({
            message: 'Error al consultar tipos de movimiento'
        })
    }
})

// Consultar últimos movimientos
router.get('/ultimos-movimientos', verifyToken, async (req, res) => {

    const id_usuario = req.user.id

    try {
        const result = await pool.query(
            `SELECT m.id, m.monto, m.descripcion, m.id_tipo_movimiento, tmov.nombre AS tipo_movimiento, m.id_categoria, c.nombre AS categoria, m.fecha
                FROM movimientos m
                JOIN categorias c ON c.id = m.id_categoria AND c.status = 1
                JOIN tipos_movimiento tmov ON tmov.id = m.id_tipo_movimiento
                WHERE m.id_usuario = $1
                ORDER BY m.created_at DESC
                limit 5
            `,
            [id_usuario]
        )

        const data = result.rows

        res.status(200).json(data)

    } catch (error) {
        console.error(error)
        res.status(500).json({
            message: 'Error al consultar últimos movimientos'
        })
    }
})

module.exports = router
