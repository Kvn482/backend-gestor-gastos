const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/mail.service');
const verifyToken = require('../middleware/auth.middleware');
const { upload, cloudinary } = require('../services/upload.service');

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
        
        // El token de verificación sigue usando el email, esto no cambia
        const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // Omitimos la columna "id" para que PostgreSQL genere el UUID automáticamente con uuid_generate_v4()
        await pool.query(
            `INSERT INTO usuarios 
            (name, last_name, email, password, verification_token, status) 
            VALUES ($1, $2, $3, $4, $5, 0)`,
            [name, last_name, email, hashedPassword, token]
        );

        res.json({ message: 'Usuario registrado. Revisa tu correo para verificar.' });

        sendVerificationEmail(email, token)
            .then(() => console.log('Email enviado'))
            .catch(err => console.error('Error enviando email:', err));

    } catch (error) {
        console.error('Error en registro:', error);

        // Control de errores de Postgres para llaves duplicadas (Código 23505)
        if (error.code === '23505') {
            // Ajustado al nombre real de tu UNIQUE CONSTRAINT en PostgreSQL
            if (error.constraint === 'usuarios_email_key') {
                return res.status(400).json({ message: 'El email ya está registrado' });
            }
        }

        res.status(500).json({ message: 'Error al registrar usuario' });
    }
});


// VERIFICAR CORREO
router.get('/verify/:token', async (req, res) => {
    const { token } = req.params;
    
    try {
        // La librería verifica automáticamente si el token es auténtico y si NO ha expirado
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Si llegamos aquí, el token es válido y no ha expirado
        await pool.query(
            `UPDATE usuarios
            SET verificado = true,
                status = 1,
                verification_token = NULL
            WHERE verification_token = $1
            RETURNING *`,
            [token]
        );

        res.send('<h1>Cuenta verificada con éxito</h1><p>Ya puedes iniciar sesión.</p>');

    } catch (error) {
        // Si el token expiró o fue manipulado, caerá aquí
        res.status(400).send('<h1>Error de verificación</h1><p>El enlace ha expirado o no es válido. Intenta solicitar uno nuevo.</p>');
    }
});


// LOGIN
router.post('/login', limiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        // Buscamos al usuario por email
        const result = await pool.query(
            `SELECT * FROM usuarios 
             WHERE email = $1 AND verificado = true AND status = 1`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ message: 'Credenciales inválidas' });
        }

        const user = result.rows[0];

        // Validamos la contraseña
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(400).json({ message: 'Credenciales inválidas' });
        }

        // Estructuramos los Payloads de los JWT. 
        // user.id ahora es un string con formato UUID (ej: 'f47ac10b-58cc-4372-a567-0e02b2c3d479')
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

        // Enviamos la respuesta al frontend
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
        console.error('Error en login:', error);
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

// ACTUALIZAR AVATAR
router.patch('/perfil/avatar', verifyToken, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No se envió ninguna imagen' });
        }

        const avatarUrl = req.file.path;

        await pool.query(
            'UPDATE usuarios SET avatar_url = $1 WHERE id = $2',
            [avatarUrl, req.user.id]
        );

        res.json({ message: 'Avatar actualizado correctamente', avatar_url: avatarUrl });

    } catch (error) {
        console.error('Error en actualizar avatar:', error);
        res.status(500).json({ message: 'Error al actualizar avatar' });
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

// OBTENER PERFIL
router.get('/perfil', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, last_name, email, avatar_url FROM usuarios WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const user = result.rows[0];

        res.json({
            id: user.id,
            nombre: user.name,
            apellido: user.last_name,
            email: user.email,
            avatar_url: user.avatar_url,
        });

    } catch (error) {
        console.error('Error en obtener perfil:', error);
        res.status(500).json({ message: 'Error al obtener perfil' });
    }
});

// REFRESH TOKEN
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body

    if (!refreshToken) return res.sendStatus(401)

    try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)

        const newAccessToken = jwt.sign(
            { id: decoded.id, nombre: decoded.nombre, apellido: decoded.apellido, email: decoded.email },
            process.env.JWT_SECRET,
            { expiresIn: '2h' }
        )

        const newRefreshToken = jwt.sign(
            { id: decoded.id, nombre: decoded.nombre, apellido: decoded.apellido, email: decoded.email },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: '7d' }
        )

        res.json({
            message: 'Token refrescado exitosamente',
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            user: {
                id: decoded.id,
                nombre: decoded.nombre,
                apellido: decoded.apellido,
                email: decoded.email,
            }
        })

    } catch (error) {
        console.error(error)
        return res.sendStatus(403)
    }
})

// Envio de email de verificación al registrar un nuevo usuario
router.post('/resend-activation', limiter, async (req, res) => {
    try {
        const { email } = req.body;

        const result = await pool.query(
            `SELECT * FROM usuarios 
            WHERE email = $1 AND verificado = false`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(202).json({ message: 'Correo no encontrado o ya verificado' });
        }

        // En lugar de crypto, firmas un token con expiración de 1 hora (1h)
        const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });

        await pool.query(
            `UPDATE usuarios 
             SET verification_token = $1 
             WHERE email = $2`,
            [token, email]
        );

        res.json({ message: 'Correo Enviado. Revisa tu correo para verificar.' });

        sendVerificationEmail(email, token)
            .then(() => console.log('Email enviado'))
            .catch(err => console.error('Error enviando email:', err))

    } catch (error) {
        console.error('Error en enviar email de verificación:', error);
        res.status(500).json({ message: 'Error al enviar email de verificación' })
    }
})

module.exports = router;
