const express = require('express')
const pool = require('../db')
const verifyToken = require('../middleware/auth.middleware')
const { buildCreditAlerts } = require('../services/alertas-creditos.service')

const router = express.Router()

router.get('/', verifyToken, async (req, res) => {
    try {
        const alertas = await buildCreditAlerts(pool, req.user.id)

        return res.status(200).json(alertas)
    } catch (error) {
        console.error('Error al consultar alertas de creditos:', error)

        return res.status(500).json({
            message: 'Error al consultar alertas de creditos'
        })
    }
})

module.exports = router
