const express = require('express')
const pool = require('../db')
const verifyToken = require('../middleware/auth.middleware')

const router = express.Router()

// Crear movimiento
router.post('/', verifyToken, async (req, res) => {
    const id_usuario = req.user.id
    const client = await pool.connect()

    try {
        const { etiquetas = [], descripcion, fecha, monto, tipoMovimiento, notas } = req.body

        await client.query('BEGIN')

        const result = await client.query(
            `INSERT INTO movimientos 
            (id_usuario, id_tipo_movimiento, monto, descripcion, fecha, notas) 
            VALUES ($1,$2,$3,$4,$5,$6)
            RETURNING id`,
            [id_usuario, tipoMovimiento, monto, descripcion, fecha, notas]
        )

        const id_movimiento = result.rows[0].id

        if (etiquetas.length > 0) {
            const values = etiquetas.map((_, i) => `($1, $${i + 2})`).join(', ')
            await client.query(
                `INSERT INTO movimiento_etiquetas (id_movimiento, id_etiqueta) VALUES ${values}`,
                [id_movimiento, ...etiquetas]
            )
        }

        await client.query('COMMIT')

        res.status(201).json({ message: 'Movimiento Registrado' })

    } catch (error) {
        await client.query('ROLLBACK')
        console.error(error)
        res.status(500).json({
            message: 'Error al registrar movimiento'
        })
    } finally {
        client.release()
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
            message: 'Error al consultar balance general'
        })
    }
})

// Consultar etiquetas disponibles para el usuario
router.get('/etiquetas', verifyToken, async (req, res) => {
    const id_usuario = req.user.id

    try {
        const result = await pool.query(
            `SELECT id, nombre, color FROM etiquetas
                WHERE status = 1 AND (id_usuario IS NULL OR id_usuario = $1)
            `,
            [id_usuario]
        )

        const data = result.rows

        res.status(200).json(data)

    } catch (error) {
        console.error(error)
        res.status(500).json({
            message: 'Error al consultar etiquetas'
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
            `SELECT m.id, m.monto, m.descripcion, m.id_tipo_movimiento, tmov.nombre AS tipo_movimiento,
                COALESCE(array_agg(json_build_object('nombre', e.nombre, 'color', e.color)) FILTER (WHERE e.id IS NOT NULL), '{}') AS etiquetas, m.fecha, m.notas
                FROM movimientos m
                JOIN tipos_movimiento tmov ON tmov.id = m.id_tipo_movimiento
                LEFT JOIN movimiento_etiquetas me ON me.id_movimiento = m.id
                LEFT JOIN etiquetas e ON e.id = me.id_etiqueta AND e.status = 1
                WHERE m.id_usuario = $1
                GROUP BY m.id, tmov.nombre
                ORDER BY m.created_at DESC
                LIMIT 5
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
