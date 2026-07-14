const express = require('express')
const pool = require('../db')
const verifyToken = require('../middleware/auth.middleware')

const router = express.Router()

const normalizeDateOnly = (value) => {
    if (typeof value === 'string') {
        const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
        if (match) return match[1]
    }

    return value
}

const insertMovimientoEtiquetas = async (client, id_movimiento, etiquetas = []) => {
    if (!Array.isArray(etiquetas) || etiquetas.length === 0) return

    const values = etiquetas.map((_, i) => `($1, $${i + 2})`).join(', ')
    await client.query(
        `INSERT INTO movimiento_etiquetas (id_movimiento, id_etiqueta) VALUES ${values}`,
        [id_movimiento, ...etiquetas]
    )
}

const getMontoFirmado = (monto, id_tipo_movimiento) => {
    const montoNumerico = Math.abs(Number(monto))

    return Number(id_tipo_movimiento) === 2 ? montoNumerico * -1 : montoNumerico
}

// Crear movimiento
router.post('/', verifyToken, async (req, res) => {
    // req.user.id ahora contiene el UUID del usuario autenticado (ej: 'f47ac10b-...')
    const id_usuario = req.user.id
    const client = await pool.connect()

    try {
        const { etiquetas = [], descripcion, fecha, monto, tipoMovimiento, notas, cuenta } = req.body
        const fechaMovimiento = normalizeDateOnly(fecha)

        await client.query('BEGIN')

        // Insertamos el movimiento. PostgreSQL validará automáticamente que id_usuario sea un UUID existente.
        const result = await client.query(
            `INSERT INTO movimientos 
            (id_usuario, id_tipo_movimiento, monto, descripcion, fecha, notas, id_cuenta) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id`,
            [id_usuario, tipoMovimiento, monto, descripcion, fechaMovimiento, notas, cuenta]
        )

        const id_movimiento = result.rows[0].id

        // Actualizamos el saldo de la cuenta dentro de la misma transacción.
        const cuentaActualizada = await client.query(
            `UPDATE cuentas
            SET saldo_actual = COALESCE(saldo_actual, 0) + $1::numeric
            WHERE id = $2
            RETURNING saldo_actual`,
            [monto, cuenta]
        )

        if (cuentaActualizada.rowCount === 0) {
            await client.query('ROLLBACK')
            return res.status(404).json({
                message: 'Cuenta no encontrada o inactiva'
            })
        }

        // La inserción de etiquetas asociadas se mantiene igual, 
        // ya que id_movimiento sigue siendo un entero SERIAL en tu esquema.
        await insertMovimientoEtiquetas(client, id_movimiento, etiquetas)

        await client.query('COMMIT')

        res.status(201).json({ message: 'Movimiento Registrado' })

    } catch (error) {
        await client.query('ROLLBACK')
        console.error('Error al registrar movimiento:', error)
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
                COALESCE(SUM(monto), 0) AS balance
                FROM movimientos
                WHERE id_usuario = $1
                AND status = 1
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
            `SELECT id, id_usuario, nombre, color FROM etiquetas
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
                COALESCE(array_agg(json_build_object('id', e.id, 'nombre', e.nombre, 'color', e.color)) FILTER (WHERE e.id IS NOT NULL), '{}') AS etiquetas, m.fecha, m.notas, m.id_cuenta, c.nombre AS cuenta, c.tipo AS tipo_cuenta
                FROM movimientos m
                JOIN tipos_movimiento tmov ON tmov.id = m.id_tipo_movimiento
                LEFT JOIN movimiento_etiquetas me ON me.id_movimiento = m.id
                LEFT JOIN etiquetas e ON e.id = me.id_etiqueta
                JOIN cuentas c ON c.id = m.id_cuenta
                WHERE m.id_usuario = $1
                AND m.status = 1
                GROUP BY m.id, tmov.nombre, c.nombre, c.tipo
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

// Crear etiqueta personalizada
router.post('/etiquetas', verifyToken, async (req, res) => {
    const id_usuario = req.user.id

    try {
        const { nombre, color } = req.body

        if (!nombre || nombre.trim() === '') {
            return res.status(400).json({ message: 'El nombre es requerido' })
        }

        const hexColorRegex = /^#[0-9A-Fa-f]{6}$/
        if (!color || !hexColorRegex.test(color)) {
            return res.status(400).json({ message: 'El color debe ser un hexadecimal válido (ej. #6366f1)' })
        }

        const existing = await pool.query(
            'SELECT id FROM etiquetas WHERE nombre = $1 AND id_usuario = $2',
            [nombre.trim(), id_usuario]
        )

        if (existing.rows.length > 0) {
            return res.status(409).json({ message: 'Ya existe una etiqueta con ese nombre' })
        }

        const result = await pool.query(
            `INSERT INTO etiquetas (nombre, color, id_usuario, status) VALUES ($1, $2, $3, 1)
             RETURNING id, nombre, color, id_usuario`,
            [nombre.trim(), color, id_usuario]
        )

        res.status(201).json(result.rows[0])

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: 'Error al crear etiqueta' })
    }
})

// Eliminar etiqueta del usuario
router.delete('/etiquetas/:id', verifyToken, async (req, res) => {
    const id_usuario = req.user.id
    const { id } = req.params

    try {
        const result = await pool.query(
            'SELECT id, id_usuario FROM etiquetas WHERE id = $1',
            [id]
        )

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Etiqueta no encontrada' })
        }

        const etiqueta = result.rows[0]

        if (etiqueta.id_usuario === null || etiqueta.id_usuario !== id_usuario) {
            return res.status(403).json({ message: 'No tienes permiso para eliminar esta etiqueta' })
        }

        await pool.query('UPDATE etiquetas SET status = 0 WHERE id = $1', [id])

        res.json({ message: 'Etiqueta eliminada correctamente' })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: 'Error al eliminar etiqueta' })
    }
})

// Consultar últimos movimientos
router.get('/cuenta/:id', verifyToken, async (req, res) => {

    const id_usuario = req.user.id
    const { id } = req.params

    try {
        const result = await pool.query(
            `SELECT m.id, m.monto, m.descripcion, m.id_tipo_movimiento, tmov.nombre AS tipo_movimiento,
                COALESCE(array_agg(json_build_object('id', e.id, 'nombre', e.nombre, 'color', e.color)) FILTER (WHERE e.id IS NOT NULL), '{}') AS etiquetas, m.fecha, m.notas, m.id_cuenta, c.nombre AS cuenta, c.tipo AS tipo_cuenta
                FROM movimientos m
                JOIN tipos_movimiento tmov ON tmov.id = m.id_tipo_movimiento
                LEFT JOIN movimiento_etiquetas me ON me.id_movimiento = m.id
                LEFT JOIN etiquetas e ON e.id = me.id_etiqueta
                JOIN cuentas c ON c.id = m.id_cuenta
                WHERE m.id_usuario = $1
                AND m.id_cuenta = $2
                AND m.status = 1
                GROUP BY m.id, tmov.nombre, c.nombre, c.tipo
                ORDER BY m.created_at DESC
                
            `,
            [id_usuario, id]
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

// Editar movimiento anulando el registro original y creando uno nuevo
const editarMovimiento = async (req, res) => {
    const id_usuario = req.user.id
    const { id } = req.params
    const client = await pool.connect()

    try {
        const {
            etiquetas = [],
            descripcion,
            fecha,
            monto,
            tipoMovimiento,
            notas,
            cuenta,
            id_cuenta_origen,
            id_cuenta_destino
        } = req.body

        if (monto === undefined || monto === null || Number.isNaN(Number(monto)) || Math.abs(Number(monto)) <= 0) {
            return res.status(400).json({ message: 'El monto debe ser mayor a 0' })
        }

        await client.query('BEGIN')

        const movimientoResult = await client.query(
            `SELECT id, id_usuario, id_tipo_movimiento, monto, descripcion, fecha, notas, id_cuenta, id_cuenta_destino
             FROM movimientos
             WHERE id = $1 AND id_usuario = $2 AND status = 1
             FOR UPDATE`,
            [id, id_usuario]
        )

        if (movimientoResult.rows.length === 0) {
            await client.query('ROLLBACK')
            return res.status(404).json({ message: 'Movimiento no encontrado' })
        }

        const movimientoOriginal = movimientoResult.rows[0]
        const esTransferenciaOriginal = movimientoOriginal.id_cuenta_destino !== null
        let movimientosAnteriores = [movimientoOriginal]

        if (esTransferenciaOriginal) {
            const movimientoRelacionadoResult = await client.query(
                `SELECT id, id_usuario, id_tipo_movimiento, monto, descripcion, fecha, notas, id_cuenta, id_cuenta_destino
                 FROM movimientos
                 WHERE id_usuario = $1
                 AND id <> $2
                 AND status = 1
                 AND id_cuenta = $3
                 AND id_cuenta_destino = $4
                 AND ABS(monto) = ABS($5::numeric)
                 AND fecha = $6
                 ORDER BY ABS(id - $2::int) ASC
                 LIMIT 1
                 FOR UPDATE`,
                [
                    id_usuario,
                    movimientoOriginal.id,
                    movimientoOriginal.id_cuenta_destino,
                    movimientoOriginal.id_cuenta,
                    movimientoOriginal.monto,
                    movimientoOriginal.fecha
                ]
            )

            if (movimientoRelacionadoResult.rows.length === 0) {
                await client.query('ROLLBACK')
                return res.status(409).json({
                    message: 'No se encontró el movimiento relacionado de la transferencia'
                })
            }

            movimientosAnteriores = [movimientoOriginal, movimientoRelacionadoResult.rows[0]]
        }

        for (const movimiento of movimientosAnteriores) {
            await client.query(
                `UPDATE cuentas
                 SET saldo_actual = COALESCE(saldo_actual, 0) - $1::numeric
                 WHERE id = $2 AND id_usuario = $3`,
                [movimiento.monto, movimiento.id_cuenta, id_usuario]
            )
        }

        await client.query(
            `UPDATE movimientos
             SET status = 0
             WHERE id = ANY($1::int[]) AND id_usuario = $2`,
            [movimientosAnteriores.map((movimiento) => movimiento.id), id_usuario]
        )

        const fechaMovimiento = normalizeDateOnly(fecha) || normalizeDateOnly(movimientoOriginal.fecha)
        const descripcionMovimiento = descripcion ?? movimientoOriginal.descripcion
        const notasMovimiento = notas ?? movimientoOriginal.notas
        const nuevosMovimientos = []

        if (esTransferenciaOriginal || id_cuenta_destino) {
            const movimientoEgreso = movimientosAnteriores.find((movimiento) => Number(movimiento.monto) < 0)
            const movimientoIngreso = movimientosAnteriores.find((movimiento) => Number(movimiento.monto) > 0)
            const cuentaOrigen = id_cuenta_origen || cuenta || movimientoEgreso?.id_cuenta || movimientoOriginal.id_cuenta
            const cuentaDestino = id_cuenta_destino || movimientoIngreso?.id_cuenta || movimientoOriginal.id_cuenta_destino
            const montoTransferencia = Math.abs(Number(monto))

            if (!cuentaOrigen || !cuentaDestino || String(cuentaOrigen) === String(cuentaDestino)) {
                console.log(cuentaOrigen, cuentaDestino)
                await client.query('ROLLBACK')
                return res.status(400).json({
                    message: 'La cuenta origen y destino son requeridas y deben ser diferentes'
                })
            }

            const cuentasResult = await client.query(
                `SELECT id FROM cuentas
                 WHERE id_usuario = $1 AND status = 1 AND id = ANY($2::uuid[])`,
                [id_usuario, [cuentaOrigen, cuentaDestino]]
            )

            if (cuentasResult.rowCount !== 2) {
                await client.query('ROLLBACK')
                return res.status(404).json({
                    message: 'Cuenta origen o destino no encontrada'
                })
            }

            await client.query(
                `UPDATE cuentas
                 SET saldo_actual = COALESCE(saldo_actual, 0) - $1::numeric
                 WHERE id = $2 AND id_usuario = $3`,
                [montoTransferencia, cuentaOrigen, id_usuario]
            )

            await client.query(
                `UPDATE cuentas
                 SET saldo_actual = COALESCE(saldo_actual, 0) + $1::numeric
                 WHERE id = $2 AND id_usuario = $3`,
                [montoTransferencia, cuentaDestino, id_usuario]
            )

            const egresoResult = await client.query(
                `INSERT INTO movimientos
                 (id_usuario, id_tipo_movimiento, monto, descripcion, fecha, notas, id_cuenta, id_cuenta_destino)
                 VALUES ($1, 2, $2, $3, $4, $5, $6, $7)
                 RETURNING id`,
                [id_usuario, montoTransferencia * -1, descripcionMovimiento, fechaMovimiento, notasMovimiento, cuentaOrigen, cuentaDestino]
            )

            const ingresoResult = await client.query(
                `INSERT INTO movimientos
                 (id_usuario, id_tipo_movimiento, monto, descripcion, fecha, notas, id_cuenta, id_cuenta_destino)
                 VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
                 RETURNING id`,
                [id_usuario, montoTransferencia, descripcionMovimiento, fechaMovimiento, notasMovimiento, cuentaDestino, cuentaOrigen]
            )

            nuevosMovimientos.push(egresoResult.rows[0].id, ingresoResult.rows[0].id)
        } else {
            const cuentaMovimiento = cuenta || movimientoOriginal.id_cuenta
            const tipoMovimientoNuevo = tipoMovimiento || movimientoOriginal.id_tipo_movimiento
            const montoMovimiento = getMontoFirmado(monto, tipoMovimientoNuevo)

            const cuentaResult = await client.query(
                `SELECT id FROM cuentas
                 WHERE id = $1 AND id_usuario = $2 AND status = 1`,
                [cuentaMovimiento, id_usuario]
            )

            if (cuentaResult.rowCount === 0) {
                await client.query('ROLLBACK')
                return res.status(404).json({ message: 'Cuenta no encontrada' })
            }

            const nuevoMovimientoResult = await client.query(
                `INSERT INTO movimientos
                 (id_usuario, id_tipo_movimiento, monto, descripcion, fecha, notas, id_cuenta)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id`,
                [id_usuario, tipoMovimientoNuevo, montoMovimiento, descripcionMovimiento, fechaMovimiento, notasMovimiento, cuentaMovimiento]
            )

            await client.query(
                `UPDATE cuentas
                 SET saldo_actual = COALESCE(saldo_actual, 0) + $1::numeric
                 WHERE id = $2 AND id_usuario = $3`,
                [montoMovimiento, cuentaMovimiento, id_usuario]
            )

            nuevosMovimientos.push(nuevoMovimientoResult.rows[0].id)
        }

        for (const id_movimiento of nuevosMovimientos) {
            await insertMovimientoEtiquetas(client, id_movimiento, etiquetas)
        }

        await client.query('COMMIT')

        res.status(200).json({
            message: 'Movimiento actualizado con éxito',
            movimientos_creados: nuevosMovimientos
        })

    } catch (error) {
        await client.query('ROLLBACK')
        console.error('Error al editar movimiento:', error)
        res.status(500).json({
            message: 'Error al editar movimiento'
        })
    } finally {
        client.release()
    }
}

router.patch('/edit/:id', verifyToken, editarMovimiento)
router.put('/edit/:id', verifyToken, editarMovimiento)

module.exports = router
