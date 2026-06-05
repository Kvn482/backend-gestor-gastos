const nodemailer = require('nodemailer');

// const transporter = nodemailer.createTransport({
//   service: 'gmail',
//   auth: {
//     user: process.env.MAIL_USER,
//     pass: process.env.MAIL_PASS,
//   },
// });

// const dns = require('dns');
// dns.setDefaultResultOrder('ipv4first');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,             // Cambiado de 465 a 587
  secure: false,         // false para puerto 587 (usa STARTTLS)
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS, 
  },
  tls: {
    rejectUnauthorized: false // Esto evita que Railway bloquee la conexión por temas de certificados
  }
});

async function sendVerificationEmail(email, token) {
  const link = `${process.env.BACKEND_URL}/api/auth/verify/${token}`;

  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to: email,
    subject: 'Verifica tu cuenta - Monetra',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4f46e5;">Verifica tu cuenta</h2>
        <p>Gracias por registrarte. Haz click en el siguiente enlace para verificar tu cuenta.</p>
        <a href="${link}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">
          Verificar cuenta
        </a>
        <p style="color:#888;font-size:13px;">Si no creaste una cuenta, ignora este correo.</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(email, token) {
  const link = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

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
