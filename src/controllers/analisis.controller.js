const { PERIODOS_VALIDOS, getAnalisisFinanciero } = require('../services/analisis.service')

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const getAnalisis = async (req, res) => {
    const id_usuario = req.user.id
    const { periodo = 'mes-actual', cuentaId = 'todas' } = req.query

    try {
        if (typeof periodo !== 'string' || !PERIODOS_VALIDOS.includes(periodo)) {
            return res.status(400).json({ message: 'Periodo no valido' })
        }

        if (typeof cuentaId !== 'string' || (cuentaId !== 'todas' && !UUID_REGEX.test(cuentaId))) {
            return res.status(400).json({ message: 'cuentaId no valido' })
        }

        const analisis = await getAnalisisFinanciero({
            id_usuario,
            periodo,
            cuentaId
        })

        return res.status(200).json(analisis)
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message })
        }

        console.error('Error al consultar analisis financiero:', error)
        return res.status(500).json({ message: 'Error al consultar analisis financiero' })
    }
}

module.exports = {
    getAnalisis
}
