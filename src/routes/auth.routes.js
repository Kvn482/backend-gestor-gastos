const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/mail.service');
const verifyToken = require('../middleware/auth.middleware');

const router = express.Router();
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // máximo 10 registros por IP
    message: 'Demasiados intentos. Intenta más tarde.'
});

// REGISTRO
router.post('/register', limiter, async (req, res) => {
    try {
        const { name, last_name, email, password } = req.body;

        const userExist = await pool.query(
            'SELECT * FROM usuarios WHERE email = $1',
            [email]
        );

        if (userExist.rows.length > 0) {
            return res.status(400).json({ message: 'El email ya está registrado' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const token = crypto.randomBytes(32).toString('hex');

        await pool.query(
            `INSERT INTO usuarios 
            (name, last_name, email, password, verification_token, status) 
            VALUES ($1,$2,$3,$4,$5,0)`,
            [name, last_name, email, hashedPassword, token]
        );

        res.json({ message: 'Usuario registrado. Revisa tu correo para verificar.' });

        sendVerificationEmail(email, token)
            .then(() => console.log('Email enviado'))
            .catch(err => console.error('Error enviando email:', err));

    } catch (error) {
        console.error('Error en registro:', error);

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
router.post('/login', limiter, async (req, res) => {
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

        const accessToken = jwt.sign(
            { id: user.id, nombre: user.name, apellido: user.last_name, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '2h' }
        );

        const refreshToken = jwt.sign(
            { id: user.id, nombre: user.name, apellido: user.last_name, email: user.email },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login exitoso',
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                nombre: user.name,
                apellido: user.last_name,
                email: user.email,
            },
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en login' });
    }
});

// FORGOT PASSWORD
router.post('/forgot-password', limiter, async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'El email es requerido' });
        }

        const result = await pool.query(
            'SELECT id FROM usuarios WHERE email = $1 AND verificado = true AND status = 1',
            [email]
        );

        // Respuesta genérica para no revelar si el email existe
        if (result.rows.length === 0) {
            return res.json({ message: 'Si el email está registrado, recibirás un enlace.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

        await pool.query(
            `UPDATE usuarios 
             SET reset_token = $1, reset_token_expires = $2 
             WHERE email = $3`,
            [token, expires, email]
        );

        res.json({ message: 'Si el email está registrado, recibirás un enlace.' });

        sendPasswordResetEmail(email, token)
            .then(() => console.log('Email de recuperación enviado'))
            .catch(err => console.error('Error enviando email de recuperación:', err));

    } catch (error) {
        console.error('Error en forgot-password:', error);
        res.status(500).json({ message: 'Error al procesar la solicitud' });
    }
});

// RESET PASSWORD
router.post('/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({ message: 'Token y contraseña son requeridos' });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
        }

        const result = await pool.query(
            `SELECT id FROM usuarios 
             WHERE reset_token = $1 AND reset_token_expires > NOW()`,
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ message: 'El enlace ha expirado o no es válido' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query(
            `UPDATE usuarios 
             SET password = $1, reset_token = NULL, reset_token_expires = NULL 
             WHERE reset_token = $2`,
            [hashedPassword, token]
        );

        res.json({ message: 'Contraseña restablecida correctamente' });

    } catch (error) {
        console.error('Error en reset-password:', error);
        res.status(500).json({ message: 'Error al restablecer la contraseña' });
    }
});

// ACTUALIZAR PERFIL
router.patch('/perfil', verifyToken, async (req, res) => {
    try {
        const { nombre, apellido } = req.body;

        if (!nombre || !apellido || nombre.trim() === '' || apellido.trim() === '') {
            return res.status(400).json({ message: 'Nombre y apellido son requeridos' });
        }

        await pool.query(
            'UPDATE usuarios SET name = $1, last_name = $2 WHERE id = $3',
            [nombre.trim(), apellido.trim(), req.user.id]
        );

        res.json({ message: 'Perfil actualizado correctamente' });

    } catch (error) {
        console.error('Error en actualizar perfil:', error);
        res.status(500).json({ message: 'Error al actualizar perfil' });
    }
});

// CAMBIAR CONTRASEÑA
router.patch('/cambiar-contrasena', verifyToken, async (req, res) => {
    try {
        const { contrasenaActual, nuevaContrasena } = req.body;

        if (!contrasenaActual || !nuevaContrasena) {
            return res.status(400).json({ message: 'Contraseña actual y nueva son requeridas' });
        }

        if (nuevaContrasena.length < 6) {
            return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 6 caracteres' });
        }

        const result = await pool.query(
            'SELECT password FROM usuarios WHERE id = $1',
            [req.user.id]
        );

        const match = await bcrypt.compare(contrasenaActual, result.rows[0].password);

        if (!match) {
            return res.status(400).json({ message: 'La contraseña actual es incorrecta' });
        }

        const hashedPassword = await bcrypt.hash(nuevaContrasena, 10);

        await pool.query(
            'UPDATE usuarios SET password = $1 WHERE id = $2',
            [hashedPassword, req.user.id]
        );

        res.json({ message: 'Contraseña actualizada correctamente' });

    } catch (error) {
        console.error('Error en cambiar-contrasena:', error);
        res.status(500).json({ message: 'Error al cambiar contraseña' });
    }
});

// REFRESH TOKEN
router.post('/refresh', (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) return res.sendStatus(401);

    try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

        const newAccessToken = jwt.sign(
            { id: decoded.id },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ accessToken: newAccessToken });

    } catch {
        return res.sendStatus(403);
    }
});

module.exports = router;
