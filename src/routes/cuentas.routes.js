const express = require('express')
const pool = require('../db')
const verifyToken = require('../middleware/auth.middleware')

const router = express.Router()

// CREAR UNA NUEVA CUENTA
router.post('/', verifyToken, async (req, res) => {
    // 1. Extraemos los campos del formulario de Angular
    const { nombre, tipo, saldo_inicial, color } = req.body;
    
    // 2. CRÍTICO: El id_usuario NO viene del body por seguridad. 
    // Lo extraes del token JWT que tu middleware ya debió validar y pegar en req.user
    const id_usuario = req.user.id; 

    // Validaciones básicas de entrada
    if (!nombre || !tipo) {
        return res.status(400).json({ message: 'El nombre y el tipo de cuenta son obligatorios.' });
    }

    const client = await pool.connect();

    try {
        // Iniciamos la transacción
        await client.query('BEGIN');

        // El saldo_actual inicial será exactamente igual al saldo_inicial que mande el usuario
        const saldoInicialNumerico = parseFloat(saldo_inicial) || 0;
        const colorPorDefecto = color || '#a855f7'; // Morado Monetra si viene vacío

        // 3. Insertar la nueva cuenta en la base de datos
        const nuevaCuentaResult = await client.query(
            `INSERT INTO "cuentas" ("id_usuario", "nombre", "tipo", "saldo_inicial", "saldo_actual", "color")
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [id_usuario, nombre, tipo.toUpperCase(), saldoInicialNumerico, saldoInicialNumerico, colorPorDefecto]
        );

        const nuevaCuenta = nuevaCuentaResult.rows[0];

        // 4. LA CONDICIÓN: Si el saldo inicial es mayor a 0, creamos el movimiento puente de apertura
        if (saldoInicialNumerico > 0) {
            await client.query(
                `INSERT INTO "movimientos" ("id_usuario", "id_cuenta", "monto", "descripcion", "fecha")
                 VALUES ($1, $2, $3, $4, CURRENT_DATE)`,
                [
                    id_usuario, 
                    nuevaCuenta.id, // El UUID de la cuenta que acabamos de crear arriba
                    saldoInicialNumerico, 
                    'Saldo inicial de apertura' // Descripción fija del sistema para identificarlo
                ]
            );
        }

        // Si todo el circuito se ejecutó bien, guardamos en la base de datos de verdad
        await client.query('COMMIT');

        // Respondemos a Angular con la cuenta creada para que la pinte de inmediato en el Grid
        res.status(201).json({
            message: 'Cuenta creada con éxito.',
            cuenta: nuevaCuenta
        });

    } catch (error) {
        // Si falla el insert de la cuenta O el del movimiento, el ROLLBACK limpia todo
        await client.query('ROLLBACK');
        console.error('Error al crear la cuenta:', error);
        res.status(500).json({ message: 'Error interno del servidor al crear la cuenta.' });
    } finally {
        // Liberamos la conexión al pool obligatoriamente
        client.release();
    }
});

module.exports = router
