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

module.exports = { sendVerificationEmail };
