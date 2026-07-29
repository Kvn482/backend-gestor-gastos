const express = require('express')
const pool = require('../db')
const verifyToken = require('../middleware/auth.middleware')
const {
    normalizeDateOnly,
    insertMovimientoEtiquetas,
    getMontoFirmado
} = require('../services/movimientos.service')

const router = express.Router()

const getQueryValue = (query, keys) => {
    for (const key of keys) {
        if (query[key] !== undefined && query[key] !== null && query[key] !== '') {
            return query[key]
        }
    }

    return null
}

const buildMovimientosFilters = (query, initialParams, options = {}) => {
    const params = [...initialParams]
    const filters = []
    const { includeCuentaFilter = true } = options

    const addFilter = (condition, value) => {
        params.push(value)
        filters.push(condition.replace('?', `$${params.length}`))
    }

    const id_cuenta = getQueryValue(query, ['id_cuenta', 'cuenta'])
    const id_tipo_movimiento = getQueryValue(query, ['id_tipo_movimiento', 'tipoMovimiento', 'tipo_movimiento', 'tipo'])
    const id_etiqueta = getQueryValue(query, ['id_etiqueta', 'etiqueta'])
    const fecha_inicio = getQueryValue(query, ['fecha_inicio', 'fechaInicio', 'fechaDesde', 'desde'])
    const fecha_fin = getQueryValue(query, ['fecha_fin', 'fechaFin', 'fechaHasta', 'hasta'])
    const busqueda = getQueryValue(query, ['busqueda', 'descripcion', 'search', 'q'])

    if (includeCuentaFilter && id_cuenta) {
        addFilter('m.id_cuenta = ?', id_cuenta)
    }

    if (id_tipo_movimiento) {
        addFilter('m.id_tipo_movimiento = ?', id_tipo_movimiento)
    }

    if (id_etiqueta) {
        addFilter(
            `EXISTS (
                SELECT 1
                FROM movimiento_etiquetas me_filter
                WHERE me_filter.id_movimiento = m.id
                AND me_filter.id_etiqueta = ?
            )`,
            id_etiqueta
        )
    }

    if (fecha_inicio) {
        addFilter('m.fecha >= ?::date', fecha_inicio)
    }

    if (fecha_fin) {
        addFilter('m.fecha <= ?::date', fecha_fin)
    }

    if (busqueda) {
        addFilter('(m.descripcion ILIKE ? OR m.notas ILIKE ?)', `%${busqueda}%`)
        params.push(`%${busqueda}%`)
        filters[filters.length - 1] = filters[filters.length - 1].replace('?', `$${params.length}`)
    }

    return {
        params,
        where: filters.length > 0 ? `\n                AND ${filters.join('\n                AND ')}` : ''
    }
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

// Consultar todos los movimientos activos del usuario
router.get('/', verifyToken, async (req, res) => {
    const id_usuario = req.user.id

    try {
        const { where, params } = buildMovimientosFilters(req.query, [id_usuario])

        const result = await pool.query(
            `SELECT m.id, m.monto, m.descripcion, m.id_tipo_movimiento, tmov.nombre AS tipo_movimiento,
                COALESCE(array_agg(json_build_object('id', e.id, 'nombre', e.nombre, 'color', e.color)) FILTER (WHERE e.id IS NOT NULL), '{}') AS etiquetas, TO_CHAR(m.fecha, 'YYYY-MM-DD') AS fecha, m.notas, m.id_cuenta, m.id_cuenta_destino, c.nombre AS cuenta, c.tipo AS tipo_cuenta
                FROM movimientos m
                JOIN tipos_movimiento tmov ON tmov.id = m.id_tipo_movimiento
                LEFT JOIN movimiento_etiquetas me ON me.id_movimiento = m.id
                LEFT JOIN etiquetas e ON e.id = me.id_etiqueta
                JOIN cuentas c ON c.id = m.id_cuenta
                WHERE m.id_usuario = $1
                AND m.status = 1
                ${where}
                GROUP BY m.id, tmov.nombre, c.nombre, c.tipo
                ORDER BY m.created_at DESC
            `,
            params
        )

        res.status(200).json(result.rows)

    } catch (error) {
        console.error(error)
        res.status(500).json({
            message: 'Error al consultar movimientos'
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
                COALESCE(array_agg(json_build_object('id', e.id, 'nombre', e.nombre, 'color', e.color)) FILTER (WHERE e.id IS NOT NULL), '{}') AS etiquetas, TO_CHAR(m.fecha, 'YYYY-MM-DD') AS fecha, m.notas, m.id_cuenta, m.id_cuenta_destino, c.nombre AS cuenta, c.tipo AS tipo_cuenta
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

// Eliminar movimiento o transferencia y revertir saldos
router.delete('/:id', verifyToken, async (req, res) => {
    const id_usuario = req.user.id
    const { id } = req.params
    const client = await pool.connect()

    try {
        if (!Number.isInteger(Number(id))) {
            return res.status(400).json({ message: 'Id de movimiento invalido' })
        }

        await client.query('BEGIN')

        const movimientoResult = await client.query(
            `SELECT id, id_usuario, id_tipo_movimiento, monto, descripcion, fecha, notas, id_cuenta, id_cuenta_destino, status, created_at
             FROM movimientos
             WHERE id = $1 AND id_usuario = $2
             FOR UPDATE`,
            [id, id_usuario]
        )

        if (movimientoResult.rows.length === 0) {
            await client.query('ROLLBACK')
            return res.status(404).json({ message: 'Movimiento no encontrado' })
        }

        const movimiento = movimientoResult.rows[0]

        if (Number(movimiento.status) !== 1) {
            await client.query('ROLLBACK')
            return res.status(404).json({ message: 'Movimiento no encontrado o ya eliminado' })
        }

        const esTransferencia = movimiento.id_cuenta_destino !== null

        if (!esTransferencia) {
            const cuentaResult = await client.query(
                `UPDATE cuentas
                 SET saldo_actual = COALESCE(saldo_actual, 0) - $1::numeric
                 WHERE id = $2 AND id_usuario = $3`,
                [movimiento.monto, movimiento.id_cuenta, id_usuario]
            )

            if (cuentaResult.rowCount === 0) {
                await client.query('ROLLBACK')
                return res.status(404).json({ message: 'Cuenta del movimiento no encontrada' })
            }

            await client.query(
                `UPDATE movimientos
                 SET status = 0
                 WHERE id = $1 AND id_usuario = $2 AND status = 1`,
                [movimiento.id, id_usuario]
            )

            await client.query('COMMIT')
            return res.status(200).json({ message: 'Movimiento eliminado correctamente' })
        }

        const contraparteResult = await client.query(
            `SELECT id, id_usuario, id_tipo_movimiento, monto, descripcion, fecha, notas, id_cuenta, id_cuenta_destino, status, created_at
             FROM movimientos
             WHERE id <> $1
             AND id_usuario = $2
             AND status = 1
             AND id_cuenta = $3
             AND id_cuenta_destino = $4
             AND monto = ($5::numeric * -1)
             ORDER BY ABS(id - $6::int) ASC
             LIMIT 1
             FOR UPDATE`,
            [
                movimiento.id,
                id_usuario,
                movimiento.id_cuenta_destino,
                movimiento.id_cuenta,
                movimiento.monto,
                movimiento.id
            ]
        )

        if (contraparteResult.rows.length === 0) {
            await client.query('ROLLBACK')
            return res.status(404).json({ message: 'No se encontro el movimiento contraparte de la transferencia' })
        }

        const movimientosTransferencia = [movimiento, contraparteResult.rows[0]]

        for (const movimientoTransferencia of movimientosTransferencia) {
            const cuentaResult = await client.query(
                `UPDATE cuentas
                 SET saldo_actual = COALESCE(saldo_actual, 0) - $1::numeric
                 WHERE id = $2 AND id_usuario = $3`,
                [movimientoTransferencia.monto, movimientoTransferencia.id_cuenta, id_usuario]
            )

            if (cuentaResult.rowCount === 0) {
                await client.query('ROLLBACK')
                return res.status(404).json({ message: 'Cuenta de transferencia no encontrada' })
            }
        }

        const movimientosResult = await client.query(
            `UPDATE movimientos
             SET status = 0
             WHERE id = ANY($1::int[]) AND id_usuario = $2 AND status = 1`,
            [movimientosTransferencia.map((movimientoTransferencia) => movimientoTransferencia.id), id_usuario]
        )

        if (movimientosResult.rowCount !== 2) {
            await client.query('ROLLBACK')
            return res.status(409).json({ message: 'La transferencia ya fue eliminada o no esta completa' })
        }

        await client.query('COMMIT')
        return res.status(200).json({ message: 'Movimiento eliminado correctamente' })

    } catch (error) {
        await client.query('ROLLBACK')
        console.error('Error al eliminar movimiento:', error)
        return res.status(500).json({
            message: 'Error al eliminar movimiento'
        })
    } finally {
        client.release()
    }
})

// Consultar movimientos con base en la cuenta seleccionada
router.get('/cuenta/:id', verifyToken, async (req, res) => {

    const id_usuario = req.user.id
    const { id } = req.params

    try {
        const { where, params } = buildMovimientosFilters(req.query, [id_usuario, id], {
            includeCuentaFilter: false
        })

        const result = await pool.query(
            `SELECT m.id, m.monto, m.descripcion, m.id_tipo_movimiento, tmov.nombre AS tipo_movimiento,
                COALESCE(array_agg(json_build_object('id', e.id, 'nombre', e.nombre, 'color', e.color)) FILTER (WHERE e.id IS NOT NULL), '{}') AS etiquetas, TO_CHAR(m.fecha, 'YYYY-MM-DD') AS fecha, m.notas, m.id_cuenta, m.id_cuenta_destino, c.nombre AS cuenta, c.tipo AS tipo_cuenta
                FROM movimientos m
                JOIN tipos_movimiento tmov ON tmov.id = m.id_tipo_movimiento
                LEFT JOIN movimiento_etiquetas me ON me.id_movimiento = m.id
                LEFT JOIN etiquetas e ON e.id = me.id_etiqueta
                JOIN cuentas c ON c.id = m.id_cuenta
                WHERE m.id_usuario = $1
                AND m.id_cuenta = $2
                AND m.status = 1
                ${where}
                GROUP BY m.id, tmov.nombre, c.nombre, c.tipo
                ORDER BY m.created_at DESC
                
            `,
            params
        )

        const data = result.rows

        res.status(200).json(data)

    } catch (error) {
        console.error(error)
        res.status(500).json({
            message: 'Error al consultar movimientos de la cuenta'
        })
    }
})

// Editar movimiento anulando el registro original y creando uno nuevo
router.patch('/edit/:id', verifyToken, async (req, res) => {
    const id_usuario = req.user.id
    const { id } = req.params
    const client = await pool.connect()

    try {
        const { etiquetas = [], descripcion, fecha, monto, tipoMovimiento, notas, cuenta } = req.body

        if (!fecha || !tipoMovimiento || !cuenta || monto === undefined || monto === null) {
            return res.status(400).json({ message: 'Faltan datos para editar el movimiento' })
        }

        if (Number.isNaN(Number(monto)) || Math.abs(Number(monto)) <= 0) {
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

        if (movimientoOriginal.id_cuenta_destino !== null) {
            await client.query('ROLLBACK')
            return res.status(400).json({
                message: 'Este endpoint solo edita movimientos. Las transferencias deben editarse desde su propio flujo.'
            })
        }

        await client.query(
            `UPDATE cuentas
             SET saldo_actual = COALESCE(saldo_actual, 0) - $1::numeric
             WHERE id = $2 AND id_usuario = $3`,
            [movimientoOriginal.monto, movimientoOriginal.id_cuenta, id_usuario]
        )

        await client.query(
            `UPDATE movimientos
             SET status = 0
             WHERE id = $1 AND id_usuario = $2`,
            [movimientoOriginal.id, id_usuario]
        )

        const montoMovimiento = getMontoFirmado(monto, tipoMovimiento)
        const fechaMovimiento = normalizeDateOnly(fecha)

        const cuentaResult = await client.query(
            `SELECT id FROM cuentas
             WHERE id = $1 AND id_usuario = $2 AND status = 1`,
            [cuenta, id_usuario]
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
            [id_usuario, tipoMovimiento, montoMovimiento, descripcion, fechaMovimiento, notas, cuenta]
        )

        const idNuevoMovimiento = nuevoMovimientoResult.rows[0].id

        await client.query(
            `UPDATE cuentas
             SET saldo_actual = COALESCE(saldo_actual, 0) + $1::numeric
             WHERE id = $2 AND id_usuario = $3`,
            [montoMovimiento, cuenta, id_usuario]
        )

        await insertMovimientoEtiquetas(client, idNuevoMovimiento, etiquetas)

        await client.query('COMMIT')

        res.status(200).json({
            message: 'Movimiento actualizado con exito',
            movimiento_creado: idNuevoMovimiento
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
})
module.exports = router 
