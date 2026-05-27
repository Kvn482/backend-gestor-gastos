const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendVerificationEmail(email, token) {
  const link = `http://localhost:3000/api/auth/verify/${token}`;

  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to: email,
    subject: 'Verifica tu cuenta',
    html: `
      <h2>Verifica tu cuenta</h2>
      <p>Haz click en el siguiente enlace:</p>
      <a href="${link}">${link}</a>
    `,
  });
}

async function sendPasswordResetEmail(email, token) {
  const link = `http://localhost:4200/reset-password?token=${token}`;

  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to: email,
    subject: 'Restablecer contraseña - Monetra',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4f46e5;">Restablece tu contraseña</h2>
        <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
        <p>Haz click en el siguiente enlace. Este enlace expira en <strong>1 hora</strong>.</p>
        <a href="${link}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">
          Restablecer contraseña
        </a>
        <p style="color:#888;font-size:13px;">Si no solicitaste esto, ignora este correo. Tu contraseña no cambiará.</p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
