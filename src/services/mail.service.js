const sgMail = require('@sendgrid/mail');

// Inicializamos SendGrid usando la API Key que configures en Railway
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendVerificationEmail(email, token) {
  const link = `${process.env.BACKEND_URL}/api/auth/verify/${token}`;

  const msg = {
    to: email,                     // Destinatario dinámico (cualquier usuario)
    from: process.env.MAIL_USER,   // Tu correo de Gmail (el que vas a verificar en SendGrid)
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
  };

  // Envolvemos en try/catch para atrapar el error 403
  try {
    await sgMail.send(msg);
    console.log('Email de verificación enviado con éxito');
  } catch (error) {
    console.error('Error enviando email de verificación:', error);
    if (error.response && error.response.body) {
      console.log("DETALLE COMPLETO DE SENDGRID:", JSON.stringify(error.response.body, null, 2));
    }
    throw error; // Mantenemos el throw para que tu controlador sepa que falló
  }
}

async function sendPasswordResetEmail(email, token) {
  const link = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

  const msg = {
    to: email,
    from: process.env.MAIL_USER,   // Tu correo de Gmail (el que vas a verificar en SendGrid)
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
  };

  // Envolvemos en try/catch para atrapar el error 403
  try {
    await sgMail.send(msg);
    console.log('Email de recuperación enviado con éxito');
  } catch (error) {
    console.error('Error enviando email de recuperación:', error);
    if (error.response && error.response.body) {
      console.log("DETALLE COMPLETO DE SENDGRID:", JSON.stringify(error.response.body, null, 2));
    }
    throw error; // Mantenemos el throw para que tu controlador sepa que falló
  }
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };