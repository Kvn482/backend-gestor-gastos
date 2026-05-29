const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: (req) => ({
    folder: 'avatares',
    public_id: `user_${req.user.id}`, // fijo por usuario → sobreescribe automáticamente
    overwrite: true,
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 200, height: 200, crop: 'fill' }],
  }),
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // máximo 2MB
});

module.exports = { upload, cloudinary };
