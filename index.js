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
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars && current) {
      lines.push(current.trim());
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines;
}
function buildTextSvg(text, position) {
  const upper = text.toUpperCase();
  const maxWidth = 1000;
  const maxChars = 20;
  const lines = wrapText(upper, maxChars);
  const longest = lines.reduce((a, b) => a.length > b.length ? a : b, '');
  let fontSize = Math.floor(maxWidth / (longest.length * 0.6));
  if (fontSize > 90) fontSize = 90;
  if (fontSize < 32) fontSize = 32;
  const lineHeight = fontSize * 1.1;
  const totalHeight = lines.length * lineHeight;
  let startY;
  if (position === 'top') {
    startY = 50 + fontSize;
  } else {
    startY = 1040 - totalHeight + fontSize;
  }
  const tspans = lines.map((line, i) =>
    `<tspan x="540" y="${Math.round(startY + i * lineHeight)}">${escapeXml(line)}</tspan>`
  ).join('');
  return Buffer.from(`
    <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
      <style>
        .meme {
          fill: #ffffff;
          stroke: #000000;
          stroke-width: 8px;
          paint-order: stroke;
          font-family: Arial, sans-serif;
          font-weight: 900;
          font-size: ${fontSize}px;
        }
      </style>
      <text text-anchor="middle" class="meme">${tspans}</text>
    </svg>
  `);
}
app.get('/', (req, res) => {
  res.json({ status: 'The Spark Image Merger is running' });
});
app.post('/merge', async (req, res) => {
  const { image_url, logo_url, brand_name, meme_text_top, meme_text_bottom } = req.body;
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
    const composites = [{ input: resizedLogo, left, top }];
    if (meme_text_top && meme_text_top.trim()) {
      composites.push({ input: buildTextSvg(meme_text_top, 'top'), left: 0, top: 0 });
    }
    if (meme_text_bottom && meme_text_bottom.trim()) {
      composites.push({ input: buildTextSvg(meme_text_bottom, 'bottom'), left: 0, top: 0 });
    }
    const mergedBuffer = await sharp(squareBase)
      .composite(composites)
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
