const express = require('express')
const pool = require('../db')
const verifyToken = require('../middleware/auth.middleware')

const router = express.Router()

// CREAR UNA NUEVA CUENTA
router.post('/', verifyToken, async (req, res) => {
    const { nombre, tipo, saldo_inicial, color, id_tipo_movimiento, limite_credito, dia_corte, dia_limite_pago } = req.body
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
            `INSERT INTO "cuentas" ("id_usuario", "nombre", "tipo", "saldo_inicial", "saldo_actual", "color", "limite_credito", "dia_corte", "dia_limite_pago")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [id_usuario, nombre, tipo.toUpperCase(), saldoInicialNumerico, saldoInicialNumerico, colorPorDefecto, limite_credito, dia_corte, dia_limite_pago]
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
            `SELECT id, nombre, tipo, saldo_actual, color, status, limite_credito, dia_corte, dia_limite_pago
                FROM cuentas
                WHERE id_usuario = $1
                ORDER BY created_at
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
            `SELECT id, nombre, tipo, saldo_actual 
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

// Transferir saldo entre cuentas del mismo usuario
router.post('/transferir-saldo', verifyToken, async (req, res) => {
    const id_usuario = req.user.id
    const client = await pool.connect()

    try {
        const { descripcion, notas, monto, id_cuenta_destino, id_cuenta_origen } = req.body
        const etiquetas = [6] // Etiqueta predeterminada para transferencias

        await client.query('BEGIN')

        // 1. ACTUALIZAR SALDO - CUENTA ORIGEN (Resta)
        const cuentaActualizada = await client.query(
            `UPDATE cuentas
            SET saldo_actual = COALESCE(saldo_actual, 0) - $1::numeric
            WHERE id = $2 AND id_usuario = $3
            RETURNING saldo_actual`,
            [monto, id_cuenta_origen, id_usuario]
        )

        if (cuentaActualizada.rowCount === 0) {
            await client.query('ROLLBACK')
            return res.status(404).json({
                message: 'Cuenta origen no encontrada o no pertenece al usuario'
            })
        }

        // 2. ACTUALIZAR SALDO - CUENTA DESTINO (Suma)
        const cuentaDestinoActualizada = await client.query(
            `UPDATE cuentas
            SET saldo_actual = COALESCE(saldo_actual, 0) + $1::numeric
            WHERE id = $2 AND id_usuario = $3
            RETURNING saldo_actual`,
            [monto, id_cuenta_destino, id_usuario]
        )

        if (cuentaDestinoActualizada.rowCount === 0) {
            await client.query('ROLLBACK')
            return res.status(404).json({
                message: 'Cuenta destino no encontrada o no pertenece al usuario'
            })
        }

        // 3. INSERTAR MOVIMIENTO 1: EGRESO (Desde la cuenta origen hacia la destino)
        // Nota: Cambié GETDATE() por CURRENT_DATE que es nativo de Postgres
        const resultEgreso = await client.query(
            `INSERT INTO movimientos 
            (id_usuario, id_tipo_movimiento, monto, descripcion, fecha, notas, id_cuenta, id_cuenta_destino) 
            VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7)
            RETURNING id`,
            [id_usuario, 2, monto * -1, descripcion, notas, id_cuenta_origen, id_cuenta_destino] // Supongamos 2 = Egreso por transferencia
        )
        const id_movimiento_egreso = resultEgreso.rows[0].id

        // 4. INSERTAR MOVIMIENTO 2: INGRESO (En la cuenta destino viniendo desde la origen)
        const resultIngreso = await client.query(
            `INSERT INTO movimientos 
            (id_usuario, id_tipo_movimiento, monto, descripcion, fecha, notas, id_cuenta, id_cuenta_destino) 
            VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7)
            RETURNING id`,
            [id_usuario, 1, monto, descripcion, notas, id_cuenta_destino, id_cuenta_origen] // Supongamos 1 = Ingreso por transferencia
        )
        const id_movimiento_ingreso = resultIngreso.rows[0].id

        // 5. INSERTAR ETIQUETAS (Para ambos movimientos si aplica)
        if (etiquetas.length > 0) {
            // Unimos los IDs de ambos movimientos para etiquetarlos de un solo golpe
            const movimientosAEtiquetar = [id_movimiento_egreso, id_movimiento_ingreso]
            
            for (const id_mov_id of movimientosAEtiquetar) {
                const values = etiquetas.map((_, i) => `($1, $${i + 2})`).join(', ')
                await client.query(
                    `INSERT INTO movimiento_etiquetas (id_movimiento, id_etiqueta) VALUES ${values}`,
                    [id_mov_id, ...etiquetas]
                )
            }
        }

        await client.query('COMMIT')
        res.status(201).json({ message: 'Transferencia realizada con éxito' })

    } catch (error) {
        await client.query('ROLLBACK')
        console.error('Error al registrar transferencia:', error)
        res.status(500).json({
            message: 'Error al registrar transferencia en el servidor'
        })
    } finally {
        client.release()
    }
})

// Editar cuenta
router.patch('/edit/:id', verifyToken, async (req, res) => {
    const { id } = req.params
    const { nombre, tipo, color, limite_credito, dia_corte, dia_limite_pago } = req.body
    
    const usuario_id = req.user?.id

    if (!usuario_id) {
        return res.status(401).json({ message: 'Usuario no autenticado o token inválido.' })
    }

    const client = await pool.connect()

    try {
        await client.query('BEGIN')

        const existeNombre = await client.query(
            `SELECT id FROM cuentas WHERE LOWER("nombre") = LOWER($1) AND id_usuario = $2 AND id <> $3`,
            [nombre, usuario_id, id]
        )

        if (existeNombre.rows.length > 0) {
            await client.query('ROLLBACK')
            return res.status(400).json({
                message: 'Ya tienes otra cuenta registrada con ese nombre.'
            })
        }

        await client.query(
            `UPDATE cuentas SET nombre = $1, tipo = $2, color = $3, limite_credito = $4, dia_corte = $5, dia_limite_pago = $6 WHERE id = $7`,
            [nombre, tipo, color, limite_credito, dia_corte, dia_limite_pago, id]
        )

        await client.query('COMMIT')

        return res.status(200).json({
            message: 'Cuenta actualizada con éxito.'
        })

    } catch (error) {
        await client.query('ROLLBACK')
        
        console.error(error)
        return res.status(500).json({
            message: 'Error al actualizar la cuenta',
            error: error.message
        })

    } finally {
        client.release()
    }
})

module.exports = router
