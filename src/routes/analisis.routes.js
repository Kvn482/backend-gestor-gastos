const express = require('express')
const verifyToken = require('../middleware/auth.middleware')
const { getAnalisis } = require('../controllers/analisis.controller')

const router = express.Router()

router.get('/', verifyToken, getAnalisis)

module.exports = router
