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

const insertTransferenciaEtiquetas = async (client, ids_movimientos = [], etiquetas = []) => {
    if (!Array.isArray(ids_movimientos) || ids_movimientos.length === 0) return

    for (const id_movimiento of ids_movimientos) {
        await insertMovimientoEtiquetas(client, id_movimiento, etiquetas)
    }
}

const getMontoFirmado = (monto, id_tipo_movimiento) => {
    const montoNumerico = Math.abs(Number(monto))

    return Number(id_tipo_movimiento) === 2 ? montoNumerico * -1 : montoNumerico
}

module.exports = {
    normalizeDateOnly,
    insertMovimientoEtiquetas,
    insertTransferenciaEtiquetas,
    getMontoFirmado
}
