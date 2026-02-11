const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { sendVerificationEmail } = require('../services/mail.service');

const router = express.Router();


// REGISTRO
router.post('/register', async (req, res) => {
    try {
        const { nombre, apellido, username, email, password } = req.body;

        const userExist = await pool.query(
            'SELECT * FROM usuarios WHERE email = $1',
            [email]
        );

        if (userExist.rows.length > 0) {
            return res.status(400).json({ message: 'El email ya está registrado' });
        }

        // Verificar si el username ya existe
        const usernameExist = await pool.query(
            'SELECT 1 FROM usuarios WHERE username = $1',
            [username]
        );

        if (usernameExist.rows.length > 0) {
            return res.status(400).json({ message: 'El username ya está en uso' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const token = crypto.randomBytes(32).toString('hex');

        await pool.query(
            `INSERT INTO usuarios 
      (nombre, apellido, username, email, password, verification_token, status) 
      VALUES ($1,$2,$3,$4,$5,$6,0)`,
            [nombre, apellido, username, email, hashedPassword, token]
        );

        await sendVerificationEmail(email, token);

        res.json({ message: 'Usuario registrado. Revisa tu correo para verificar.' });

    } catch (error) {

        if (error.code === '23505') {
            if (error.constraint === 'usuarios_email_unique') {
                return res.status(400).json({ message: 'El email ya está registrado' });
            }
            if (error.constraint === 'usuarios_username_unique') {
                return res.status(400).json({ message: 'El username ya está en uso' });
            }
        }

        // if (err.code === '23505') {
        //     return res.status(400).json({ message: 'El correo ya está registrado' });
        // }
        res.status(500).json({ message: 'Error al registrar usuario' });
    }
});


// VERIFICAR CORREO
router.get('/verify/:token', async (req, res) => {
    try {
        const { token } = req.params;

        const result = await pool.query(
            `UPDATE usuarios
       SET verificado = true,
           status = 1,
           verification_token = NULL
       WHERE verification_token = $1
       RETURNING *`,
            [token]
        );

        if (result.rowCount === 0) {
            return res.status(400).send('Token inválido o expirado');
        }

        res.send('Cuenta verificada correctamente');

    } catch (error) {
        console.error(error);
        res.status(500).send('Error al verificar');
    }
});


// LOGIN
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const result = await pool.query(
            `SELECT * FROM usuarios 
       WHERE email = $1 AND verificado = true AND status = 1`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ message: 'Credenciales inválidas' });
        }

        const user = result.rows[0];

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(400).json({ message: 'Credenciales inválidas' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.json({
            message: 'Login exitoso',
            token,
            user: {
                id: user.id,
                nombre: user.nombre,
                apellido: user.apellido,
                username: user.username,
                email: user.email,
            },
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en login' });
    }
});

module.exports = router;
