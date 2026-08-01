const MS_PER_DAY = 24 * 60 * 60 * 1000
const PROXIMO_PAGO_DIAS = 3

const PRIORIDAD_ALERTA = {
    atrasado: 1,
    'vence-hoy': 2,
    proximo: 3,
    'corte-hoy': 4,
    'corte-manana': 5
}

const parseDateOnly = (value) => {
    if (value instanceof Date) {
        return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
    }

    const [year, month, day] = String(value).slice(0, 10).split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day))
}

const formatDateOnly = (date) => date.toISOString().slice(0, 10)

const addDays = (date, days) => {
    const nextDate = new Date(date)
    nextDate.setUTCDate(nextDate.getUTCDate() + days)
    return nextDate
}

const diffDays = (from, to) => Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)

const daysInMonth = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()

const dateForDay = (year, monthIndex, day) => {
    const safeDay = Math.min(Number(day), daysInMonth(year, monthIndex))
    return new Date(Date.UTC(year, monthIndex, safeDay))
}

const compareDate = (a, b) => diffDays(a, b)

const getLastDateForDay = (today, day) => {
    const currentMonthDate = dateForDay(today.getUTCFullYear(), today.getUTCMonth(), day)

    if (compareDate(currentMonthDate, today) >= 0) {
        return currentMonthDate
    }

    return dateForDay(today.getUTCFullYear(), today.getUTCMonth() - 1, day)
}

const getNextDateForDay = (today, day) => {
    const currentMonthDate = dateForDay(today.getUTCFullYear(), today.getUTCMonth(), day)

    if (compareDate(today, currentMonthDate) >= 0) {
        return currentMonthDate
    }

    return dateForDay(today.getUTCFullYear(), today.getUTCMonth() + 1, day)
}

const getPaymentDueDate = (cutoffDate, diaLimitePago) => {
    const sameMonthDueDate = dateForDay(
        cutoffDate.getUTCFullYear(),
        cutoffDate.getUTCMonth(),
        diaLimitePago
    )

    if (compareDate(cutoffDate, sameMonthDueDate) > 0) {
        return sameMonthDueDate
    }

    return dateForDay(cutoffDate.getUTCFullYear(), cutoffDate.getUTCMonth() + 1, diaLimitePago)
}

const isValidAccountDay = (day) => {
    const numericDay = Number(day)
    return Number.isInteger(numericDay) && numericDay >= 1 && numericDay <= 31
}

const formatMonto = (monto) => Number(Number(monto).toFixed(2))

const getPaymentCopy = (estado, diasRestantes) => {
    if (estado === 'atrasado') {
        return {
            titulo: 'Pago atrasado',
            detalle: 'Te retrasaste con el pago de esta cuenta.',
            fecha: diasRestantes === -1 ? 'Vencio ayer' : `Vencio hace ${Math.abs(diasRestantes)} dias`,
            accion: 'Pagar ahora'
        }
    }

    if (estado === 'vence-hoy') {
        return {
            titulo: 'Hoy vence tu pago',
            detalle: 'Liquida o cubre el minimo para evitar intereses.',
            fecha: 'Hoy',
            accion: 'Pagar cuenta'
        }
    }

    return {
        titulo: 'Pago proximo',
        detalle: 'Tienes un pago pendiente por cubrir en los proximos dias.',
        fecha: diasRestantes === 1 ? 'Manana' : `En ${diasRestantes} dias`,
        accion: 'Pagar cuenta'
    }
}

const buildCreditAlerts = async (pool, idUsuario) => {
    const todayResult = await pool.query(`SELECT CURRENT_DATE::text AS today`)
    const today = parseDateOnly(todayResult.rows[0].today)
    const tomorrow = addDays(today, 1)

    const cuentasResult = await pool.query(
        `SELECT id, nombre, saldo_actual, dia_corte, dia_limite_pago
         FROM cuentas
         WHERE id_usuario = $1
         AND status = 1
         AND tipo = 'CREDITO'
         AND dia_corte IS NOT NULL
         AND dia_limite_pago IS NOT NULL`,
        [idUsuario]
    )

    const alertas = []

    for (const cuenta of cuentasResult.rows) {
        if (!isValidAccountDay(cuenta.dia_corte) || !isValidAccountDay(cuenta.dia_limite_pago)) {
            continue
        }

        const diaCorte = Number(cuenta.dia_corte)
        const diaLimitePago = Number(cuenta.dia_limite_pago)
        const lastCutoffDate = getLastDateForDay(today, diaCorte)
        const nextCutoffDate = getNextDateForDay(today, diaCorte)
        const dueDate = getPaymentDueDate(lastCutoffDate, diaLimitePago)
        const diasParaPago = diffDays(today, dueDate)
        const deudaActual = Math.max(Math.abs(Math.min(Number(cuenta.saldo_actual ?? 0), 0)), 0)

        if (deudaActual > 0) {
            const pagoPeriodoResult = await pool.query(
                `SELECT
                    COALESCE(SUM(CASE WHEN fecha <= $3::date THEN monto ELSE 0 END), 0) AS saldo_corte,
                    COALESCE(SUM(CASE WHEN fecha > $3::date AND fecha <= $4::date AND monto > 0 THEN monto ELSE 0 END), 0) AS pagos_periodo
                 FROM movimientos
                 WHERE id_usuario = $1
                 AND id_cuenta = $2
                 AND status = 1`,
                [idUsuario, cuenta.id, formatDateOnly(lastCutoffDate), formatDateOnly(today)]
            )

            const saldoCorte = Number(pagoPeriodoResult.rows[0].saldo_corte ?? 0)
            const pagosPeriodo = Number(pagoPeriodoResult.rows[0].pagos_periodo ?? 0)
            const deudaCorte = Math.max(Math.abs(Math.min(saldoCorte, 0)), 0)
            const montoPendiente = Math.max(deudaCorte - pagosPeriodo, 0)
            const pagadaEnPeriodo = deudaCorte === 0 || montoPendiente <= 0

            if (!pagadaEnPeriodo && diasParaPago <= PROXIMO_PAGO_DIAS) {
                const estado = diasParaPago < 0
                    ? 'atrasado'
                    : diasParaPago === 0
                        ? 'vence-hoy'
                        : 'proximo'
                const copy = getPaymentCopy(estado, diasParaPago)

                alertas.push({
                    cuentaId: cuenta.id,
                    cuenta: cuenta.nombre,
                    titulo: copy.titulo,
                    detalle: copy.detalle,
                    fecha: copy.fecha,
                    monto: formatMonto(montoPendiente),
                    estado,
                    accion: copy.accion
                })
            }
        }

        if (formatDateOnly(nextCutoffDate) === formatDateOnly(today)) {
            alertas.push({
                cuentaId: cuenta.id,
                cuenta: cuenta.nombre,
                titulo: 'Hoy es tu dia de corte',
                detalle: 'Las compras nuevas pueden pasar al siguiente periodo.',
                fecha: 'Corte hoy',
                estado: 'corte-hoy',
                accion: 'Ver cuenta'
            })
        } else if (formatDateOnly(nextCutoffDate) === formatDateOnly(tomorrow)) {
            alertas.push({
                cuentaId: cuenta.id,
                cuenta: cuenta.nombre,
                titulo: 'Manana es tu dia de corte',
                detalle: 'Buen momento para revisar cargos pendientes.',
                fecha: 'Corte manana',
                estado: 'corte-manana',
                accion: 'Revisar'
            })
        }
    }

    return alertas.sort((a, b) => {
        const prioridad = PRIORIDAD_ALERTA[a.estado] - PRIORIDAD_ALERTA[b.estado]
        if (prioridad !== 0) return prioridad

        return a.cuenta.localeCompare(b.cuenta)
    })
}

module.exports = {
    buildCreditAlerts
}
