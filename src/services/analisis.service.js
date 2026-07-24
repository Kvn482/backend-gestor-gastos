const pool = require('../db')

const PERIODOS_VALIDOS = ['mes-actual', 'mes-anterior', 'ultimos-3-meses']
const COLOR_SIN_CATEGORIA = '#64748b'

const pad = (value) => String(value).padStart(2, '0')

const toDateOnly = (date) => {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const startOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1)
}

const addMonths = (date, months) => {
    return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

const getMonthName = (date) => {
    return new Intl.DateTimeFormat('es-MX', { month: 'long' }).format(date)
        .replace(/^\w/, (letter) => letter.toUpperCase())
}

const getPeriodRanges = (periodo) => {
    const today = new Date()
    const currentMonthStart = startOfMonth(today)

    if (periodo === 'mes-actual') {
        const inicio = currentMonthStart
        const fin = addMonths(inicio, 1)
        const inicioAnterior = addMonths(inicio, -1)

        return {
            inicio: toDateOnly(inicio),
            fin: toDateOnly(fin),
            inicioAnterior: toDateOnly(inicioAnterior),
            finAnterior: toDateOnly(inicio)
        }
    }

    if (periodo === 'mes-anterior') {
        const inicio = addMonths(currentMonthStart, -1)
        const fin = currentMonthStart
        const inicioAnterior = addMonths(currentMonthStart, -2)

        return {
            inicio: toDateOnly(inicio),
            fin: toDateOnly(fin),
            inicioAnterior: toDateOnly(inicioAnterior),
            finAnterior: toDateOnly(inicio)
        }
    }

    const inicio = addMonths(currentMonthStart, -2)
    const fin = addMonths(currentMonthStart, 1)
    const inicioAnterior = addMonths(currentMonthStart, -5)

    return {
        inicio: toDateOnly(inicio),
        fin: toDateOnly(fin),
        inicioAnterior: toDateOnly(inicioAnterior),
        finAnterior: toDateOnly(inicio)
    }
}

const toNumber = (value) => Number(value || 0)

const roundMoney = (value) => Math.round(toNumber(value) * 100) / 100

const roundPercent = (value) => Math.round(toNumber(value) * 100) / 100

const getVariation = (actual, anterior) => {
    const currentValue = toNumber(actual)
    const previousValue = toNumber(anterior)

    if (previousValue === 0) {
        return currentValue > 0 ? 100 : 0
    }

    return ((currentValue - previousValue) / previousValue) * 100
}

const validateCuentaUsuario = async (id_usuario, cuentaId) => {
    if (cuentaId === 'todas') return

    const result = await pool.query(
        `SELECT id
         FROM cuentas
         WHERE id = $1 AND id_usuario = $2 AND status = 1`,
        [cuentaId, id_usuario]
    )

    if (result.rowCount === 0) {
        const error = new Error('Cuenta no encontrada')
        error.statusCode = 404
        throw error
    }
}

const getResumenPeriodo = async (id_usuario, cuentaId, inicio, fin) => {
    const result = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN id_tipo_movimiento = 1 THEN ABS(monto) ELSE 0 END), 0) AS ingresos,
            COALESCE(SUM(CASE WHEN id_tipo_movimiento <> 1 THEN ABS(monto) ELSE 0 END), 0) AS gastos
         FROM movimientos
         WHERE id_usuario = $1
         AND status = 1
         AND id_cuenta_destino IS NULL
         AND fecha >= $2::date
         AND fecha < $3::date
         AND ($4::uuid IS NULL OR id_cuenta = $4::uuid)`,
        [id_usuario, inicio, fin, cuentaId === 'todas' ? null : cuentaId]
    )

    return {
        ingresos: roundMoney(result.rows[0].ingresos),
        gastos: roundMoney(result.rows[0].gastos)
    }
}

const getCategorias = async (id_usuario, cuentaId, ranges, totalGastos) => {
    const result = await pool.query(
        `WITH actual AS (
            SELECT
                COALESCE(e.nombre, 'Sin categoria') AS nombre,
                COALESCE(e.color, $7) AS color,
                COALESCE(SUM(ABS(m.monto)), 0) AS monto
            FROM movimientos m
            LEFT JOIN movimiento_etiquetas me ON me.id_movimiento = m.id
            LEFT JOIN etiquetas e ON e.id = me.id_etiqueta
            WHERE m.id_usuario = $1
            AND m.status = 1
            AND m.id_cuenta_destino IS NULL
            AND m.id_tipo_movimiento <> 1
            AND m.fecha >= $2::date
            AND m.fecha < $3::date
            AND ($6::uuid IS NULL OR m.id_cuenta = $6::uuid)
            GROUP BY COALESCE(e.nombre, 'Sin categoria'), COALESCE(e.color, $7)
         ),
         anterior AS (
            SELECT
                COALESCE(e.nombre, 'Sin categoria') AS nombre,
                COALESCE(e.color, $7) AS color,
                COALESCE(SUM(ABS(m.monto)), 0) AS monto
            FROM movimientos m
            LEFT JOIN movimiento_etiquetas me ON me.id_movimiento = m.id
            LEFT JOIN etiquetas e ON e.id = me.id_etiqueta
            WHERE m.id_usuario = $1
            AND m.status = 1
            AND m.id_cuenta_destino IS NULL
            AND m.id_tipo_movimiento <> 1
            AND m.fecha >= $4::date
            AND m.fecha < $5::date
            AND ($6::uuid IS NULL OR m.id_cuenta = $6::uuid)
            GROUP BY COALESCE(e.nombre, 'Sin categoria'), COALESCE(e.color, $7)
         )
         SELECT
            COALESCE(actual.nombre, anterior.nombre) AS nombre,
            COALESCE(actual.color, anterior.color, $7) AS color,
            COALESCE(actual.monto, 0) AS monto,
            COALESCE(anterior.monto, 0) AS monto_anterior
         FROM actual
         FULL OUTER JOIN anterior
         ON actual.nombre = anterior.nombre AND actual.color = anterior.color
         WHERE COALESCE(actual.monto, 0) > 0
         ORDER BY monto DESC`,
        [
            id_usuario,
            ranges.inicio,
            ranges.fin,
            ranges.inicioAnterior,
            ranges.finAnterior,
            cuentaId === 'todas' ? null : cuentaId,
            COLOR_SIN_CATEGORIA
        ]
    )

    return result.rows.map((categoria) => {
        const monto = roundMoney(categoria.monto)

        return {
            nombre: categoria.nombre,
            monto,
            porcentaje: totalGastos > 0 ? roundPercent((monto / totalGastos) * 100) : 0,
            color: categoria.color,
            variacion: roundPercent(getVariation(monto, categoria.monto_anterior))
        }
    })
}

const getTendenciaSemanal = async (id_usuario, cuentaId, periodo, ranges) => {
    const result = await pool.query(
        `SELECT
            (
                FLOOR(
                    (
                        EXTRACT(DAY FROM fecha)::int
                        + EXTRACT(DOW FROM date_trunc('month', fecha))::int
                        - 1
                    ) / 7
                ) + 1
            )::int AS grupo,
            COALESCE(SUM(CASE WHEN id_tipo_movimiento = 1 THEN ABS(monto) ELSE 0 END), 0) AS ingresos,
            COALESCE(SUM(CASE WHEN id_tipo_movimiento <> 1 THEN ABS(monto) ELSE 0 END), 0) AS gastos
         FROM movimientos
         WHERE id_usuario = $1
         AND status = 1
         AND id_cuenta_destino IS NULL
         AND fecha >= $2::date
         AND fecha < $3::date
         AND ($4::uuid IS NULL OR id_cuenta = $4::uuid)
         GROUP BY grupo
         ORDER BY grupo`,
        [id_usuario, ranges.inicio, ranges.fin, cuentaId === 'todas' ? null : cuentaId]
    )

    const valuesByGroup = new Map(result.rows.map((row) => [Number(row.grupo), row]))
    const startDate = new Date(`${ranges.inicio}T00:00:00`)
    const endDate = new Date(`${ranges.fin}T00:00:00`)
    const lastDay = new Date(endDate.getFullYear(), endDate.getMonth(), 0).getDate()
    const firstDayOfWeek = startDate.getDay()
    const today = new Date()
    const currentDayLimit = periodo === 'mes-actual' ? today.getDate() : lastDay
    const weeks = Math.ceil((currentDayLimit + firstDayOfWeek) / 7)

    return Array.from({ length: weeks }, (_, index) => {
        const grupo = index + 1
        const row = valuesByGroup.get(grupo)

        return {
            etiqueta: `Sem ${grupo}`,
            ingresos: roundMoney(row?.ingresos),
            gastos: roundMoney(row?.gastos)
        }
    })
}

const getTendenciaMensual = async (id_usuario, cuentaId, ranges) => {
    const result = await pool.query(
        `SELECT
            date_trunc('month', fecha)::date AS mes,
            COALESCE(SUM(CASE WHEN id_tipo_movimiento = 1 THEN ABS(monto) ELSE 0 END), 0) AS ingresos,
            COALESCE(SUM(CASE WHEN id_tipo_movimiento <> 1 THEN ABS(monto) ELSE 0 END), 0) AS gastos
         FROM movimientos
         WHERE id_usuario = $1
         AND status = 1
         AND id_cuenta_destino IS NULL
         AND fecha >= $2::date
         AND fecha < $3::date
         AND ($4::uuid IS NULL OR id_cuenta = $4::uuid)
         GROUP BY mes
         ORDER BY mes`,
        [id_usuario, ranges.inicio, ranges.fin, cuentaId === 'todas' ? null : cuentaId]
    )

    const valuesByMonth = new Map(result.rows.map((row) => [row.mes, row]))
    const startDate = new Date(`${ranges.inicio}T00:00:00`)

    return Array.from({ length: 3 }, (_, index) => {
        const monthDate = addMonths(startDate, index)
        const key = toDateOnly(monthDate)
        const row = valuesByMonth.get(key)

        return {
            etiqueta: getMonthName(monthDate),
            ingresos: roundMoney(row?.ingresos),
            gastos: roundMoney(row?.gastos)
        }
    })
}

const getTendencia = async (id_usuario, cuentaId, periodo, ranges) => {
    if (periodo === 'ultimos-3-meses') {
        return getTendenciaMensual(id_usuario, cuentaId, ranges)
    }

    return getTendenciaSemanal(id_usuario, cuentaId, periodo, ranges)
}

const getComparativa = async (id_usuario, cuentaId) => {
    const currentMonthStart = startOfMonth(new Date())
    const inicio = toDateOnly(addMonths(currentMonthStart, -2))
    const fin = toDateOnly(addMonths(currentMonthStart, 1))

    const result = await pool.query(
        `SELECT
            date_trunc('month', fecha)::date AS mes,
            COALESCE(SUM(CASE WHEN id_tipo_movimiento = 1 THEN ABS(monto) ELSE 0 END), 0) AS ingresos,
            COALESCE(SUM(CASE WHEN id_tipo_movimiento <> 1 THEN ABS(monto) ELSE 0 END), 0) AS gastos
         FROM movimientos
         WHERE id_usuario = $1
         AND status = 1
         AND id_cuenta_destino IS NULL
         AND fecha >= $2::date
         AND fecha < $3::date
         AND ($4::uuid IS NULL OR id_cuenta = $4::uuid)
         GROUP BY mes
         ORDER BY mes`,
        [id_usuario, inicio, fin, cuentaId === 'todas' ? null : cuentaId]
    )

    const valuesByMonth = new Map(result.rows.map((row) => [row.mes, row]))
    const startDate = addMonths(currentMonthStart, -2)

    return Array.from({ length: 3 }, (_, index) => {
        const monthDate = addMonths(startDate, index)
        const key = toDateOnly(monthDate)
        const row = valuesByMonth.get(key)
        const ingresos = roundMoney(row?.ingresos)
        const gastos = roundMoney(row?.gastos)

        return {
            mes: getMonthName(monthDate),
            ingresos,
            gastos,
            balance: roundMoney(ingresos - gastos)
        }
    })
}

const getInsights = (resumen, categorias) => {
    const insights = []

    if (resumen.ingresos === 0) {
        insights.push({
            titulo: 'Sin ingresos registrados',
            detalle: 'No hay ingresos en este periodo. Revisa si falta capturar algun movimiento.',
            tipo: 'warning'
        })
    } else if (resumen.tasaAhorro >= 20) {
        insights.push({
            titulo: 'Buen margen de ahorro',
            detalle: `Conservas ${resumen.tasaAhorro}% de tus ingresos del periodo.`,
            tipo: 'success'
        })
    }

    const categoriaEnAumento = categorias.find((categoria) => categoria.variacion > 15)
    if (categoriaEnAumento) {
        insights.push({
            titulo: `${categoriaEnAumento.nombre} va al alza`,
            detalle: `Esta categoria subio ${categoriaEnAumento.variacion}% contra el periodo anterior.`,
            tipo: 'warning'
        })
    }

    if (resumen.variacionGastos < 0) {
        insights.push({
            titulo: 'Gastos a la baja',
            detalle: `Tus gastos bajaron ${Math.abs(resumen.variacionGastos)}% respecto al periodo anterior.`,
            tipo: resumen.tasaAhorro >= 20 ? 'success' : 'info'
        })
    }

    if (insights.length === 0) {
        insights.push({
            titulo: 'Periodo estable',
            detalle: 'Tus ingresos y gastos se mantienen sin cambios relevantes frente al periodo anterior.',
            tipo: 'info'
        })
    }

    return insights.slice(0, 3)
}

const getAnalisisFinanciero = async ({ id_usuario, periodo, cuentaId }) => {
    const ranges = getPeriodRanges(periodo)

    await validateCuentaUsuario(id_usuario, cuentaId)

    const [actual, anterior] = await Promise.all([
        getResumenPeriodo(id_usuario, cuentaId, ranges.inicio, ranges.fin),
        getResumenPeriodo(id_usuario, cuentaId, ranges.inicioAnterior, ranges.finAnterior)
    ])

    const balance = roundMoney(actual.ingresos - actual.gastos)
    const resumen = {
        ingresos: actual.ingresos,
        gastos: actual.gastos,
        balance,
        tasaAhorro: actual.ingresos > 0 ? roundPercent((balance / actual.ingresos) * 100) : 0,
        variacionGastos: roundPercent(getVariation(actual.gastos, anterior.gastos)),
        variacionIngresos: roundPercent(getVariation(actual.ingresos, anterior.ingresos))
    }

    const [categorias, tendencia, comparativa] = await Promise.all([
        getCategorias(id_usuario, cuentaId, ranges, resumen.gastos),
        getTendencia(id_usuario, cuentaId, periodo, ranges),
        getComparativa(id_usuario, cuentaId)
    ])

    return {
        resumen,
        categorias,
        tendencia,
        insights: getInsights(resumen, categorias),
        comparativa
    }
}

module.exports = {
    PERIODOS_VALIDOS,
    getAnalisisFinanciero
}
