const express = require('express');
const sharp = require('sharp');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const app = express();
app.use(express.json({ limit: '10mb' }));
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
app.get('/', (req, res) => {
  res.json({ status: 'The Spark Image Merger is running' });
});
app.post('/merge', async (req, res) => {
  const { image_url, logo_url, brand_name } = req.body;
  if (!image_url || !logo_url) {
    return res.status(400).json({ error: 'image_url and logo_url are required' });
  }
  try {
    const [imageResponse, logoResponse] = await Promise.all([
      axios.get(image_url, { responseType: 'arraybuffer', timeout: 30000 }),
      axios.get(logo_url, { responseType: 'arraybuffer', timeout: 30000 }),
    ]);
    const imageBuffer = Buffer.from(imageResponse.data);
    const logoBuffer = Buffer.from(logoResponse.data);
    const squareBase = await sharp(imageBuffer)
      .resize(1080, 1080, { fit: 'cover' })
      .toBuffer();
    const logoWidth = 250;
    const padding = 40;
    const resizedLogo = await sharp(logoBuffer)
      .resize(logoWidth)
      .png()
      .toBuffer();
    const logoMeta = await sharp(resizedLogo).metadata();
    const left = 1080 - logoMeta.width - padding;
    const top = 1080 - logoMeta.height - padding;
    const mergedBuffer = await sharp(squareBase)
      .composite([{ input: resizedLogo, left, top }])
      .jpeg({ quality: 90 })
      .toBuffer();
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: 'the-spark', public_id: `meme_${Date.now()}` },
        (error, result) => error ? reject(error) : resolve(result)
      ).end(mergedBuffer);
    });
    res.json({ 
      branded_url: uploadResult.secure_url,
      brand_name: brand_name || null
    });
  } catch (error) {
    console.error('Merge error:', error.message);
    res.status(500).json({ 
      error: error.message,
      stage: error.config ? 'image_download' : 'processing'
    });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
