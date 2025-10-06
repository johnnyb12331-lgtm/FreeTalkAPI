const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-randomstring.ext
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// File filter for images and videos
const fileFilter = (req, file, cb) => {
  console.log('📁 File upload attempt:');
  console.log('   Original name:', file.originalname);
  console.log('   Mimetype:', file.mimetype);
  console.log('   Field name:', file.fieldname);

  // Allowed image types
  const imageTypes = /jpeg|jpg|png|gif|webp|bmp|jpe/i;
  // Allowed video types
  const videoTypes = /mp4|avi|mov|wmv|flv|mkv|webm/i;
  // Allowed document types
  const documentTypes = /pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|csv|zip|rar|7z/i;
  
  const extname = path.extname(file.originalname).toLowerCase().replace('.', '');
  const mimetype = file.mimetype.toLowerCase();

  console.log('   Extension:', extname);

  // Check if file is image (check extension OR mimetype)
  if (mimetype.startsWith('image/') || imageTypes.test(extname)) {
    console.log('✅ Image file accepted');
    return cb(null, true);
  }
  
  // Check if file is video (check extension OR mimetype)
  if (mimetype.startsWith('video/') || videoTypes.test(extname)) {
    console.log('✅ Video file accepted');
    return cb(null, true);
  }

  // Check if file is document (check extension OR mimetype)
  if (mimetype.includes('application/') || mimetype.includes('text/') || documentTypes.test(extname)) {
    console.log('✅ Document file accepted');
    return cb(null, true);
  }

  console.log('❌ File rejected - not an allowed file type');
  cb(new Error('Only image, video, and document files are allowed!'));
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  }
});

module.exports = upload;
