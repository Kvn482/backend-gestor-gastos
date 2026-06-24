const express = require('express')
const pool = require('../db')
const verifyToken = require('../middleware/auth.middleware')

const router = express.Router()

// CREAR UNA NUEVA CUENTA
router.post('/', verifyToken, async (req, res) => {
    const { nombre, tipo, saldo_inicial, color, id_tipo_movimiento } = req.body
    const id_usuario = req.user.id 

    if (!nombre || !tipo) {
        return res.status(400).json({ message: 'El nombre y el tipo de cuenta son obligatorios.' })
    }

    const client = await pool.connect()

    try {
        const cuentaExistente = await client.query(
            'SELECT id FROM "cuentas" WHERE "id_usuario" = $1 AND LOWER("nombre") = LOWER($2)',
            [id_usuario, nombre.trim()]
        )

        if (cuentaExistente.rows.length > 0) {
            return res.status(400).json({ message: 'Ya tienes una cuenta registrada con este nombre.' })
        }

        await client.query('BEGIN')

        let saldoInicialNumerico = parseFloat(saldo_inicial) || 0
        saldoInicialNumerico = id_tipo_movimiento === 2 ? saldoInicialNumerico * -1 : saldoInicialNumerico
        const colorPorDefecto = color || '#a855f7'

        const nuevaCuentaResult = await client.query(
            `INSERT INTO "cuentas" ("id_usuario", "nombre", "tipo", "saldo_inicial", "saldo_actual", "color")
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [id_usuario, nombre, tipo.toUpperCase(), saldoInicialNumerico, saldoInicialNumerico, colorPorDefecto]
        )

        const nuevaCuenta = nuevaCuentaResult.rows[0]

        if (saldoInicialNumerico !== 0) {
            await client.query(
                `INSERT INTO "movimientos" ("id_usuario", "id_tipo_movimiento", "id_cuenta", "monto", "descripcion", "fecha")
                 VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)`,
                [
                    id_usuario, 
                    id_tipo_movimiento,
                    nuevaCuenta.id,
                    saldoInicialNumerico, 
                    'Saldo inicial de apertura'
                ]
            )
        }

        await client.query('COMMIT')

        res.status(201).json({
            message: 'Cuenta creada con éxito.',
            cuenta: nuevaCuenta
        })

    } catch (error) {
        await client.query('ROLLBACK')
        console.error('Error al crear la cuenta:', error)
        res.status(500).json({ message: 'Error interno del servidor al crear la cuenta.' })
    } finally {
        client.release()
    }
})

// Consultar todas las cuentas activas de un usuario
router.get('/', verifyToken, async (req, res) => {

    const id_usuario = req.user.id

    try {
        const result = await pool.query(
            `SELECT id, nombre, tipo, saldo_actual, color, status
                FROM cuentas
                WHERE id_usuario = $1
            `,
            [id_usuario]
        )

        const data = result.rows

        res.status(200).json(data)

    } catch (error) {
        console.error(error)
        res.status(500).json({
            message: 'Error al consultar las cuentas activas del usuario',
            error: error.message
        })
    }
})

router.get('/activas', verifyToken, async (req, res) => {
    const id_usuario = req.user.id

    try {
        const result = await pool.query(
            `SELECT id, nombre, tipo 
             FROM cuentas
             WHERE id_usuario = $1 AND status = 1
             ORDER BY nombre ASC`,
            [id_usuario]
        )

        return res.status(200).json(result.rows)

    } catch (error) {
        console.error(error)
        return res.status(500).json({
            message: 'Error al consultar las cuentas activas',
            error: error.message
        })
    }
})

// Actualizar estado de una cuenta (activar/desactivar)
router.patch('/update-status', verifyToken, async (req, res) => {
    const { id_cuenta, status } = req.body
    const client = await pool.connect()

    try {
        await client.query('BEGIN')
        await client.query(
            `UPDATE cuentas SET status = $1 WHERE id = $2`,
            [status, id_cuenta]
        )

        await client.query('COMMIT')

        return res.status(200).json({
            message: 'Cuenta actualizada con éxito.',
            cuenta: { id: id_cuenta, status: status }
        })

    } catch (error) {
        await client.query('ROLLBACK')
        
        console.error(error)
        return res.status(500).json({
            message: 'Error al actualizar el estado de la cuenta',
            error: error.message
        })

    } finally {
        client.release()
    }
})

module.exports = router
