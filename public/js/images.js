// Фото сжимаются прямо в телефоне: загрузка быстрее и база не переполняется.
import { LIMITS } from './catalog.js';

async function decode(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // поворот по EXIF браузер применяет сам
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

async function encode(img, side, target, hardLimit, type) {
  let size = side;
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // прозрачный PNG не должен стать чёрным
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob;
    for (const quality of [0.8, 0.7, 0.6, 0.5]) {
      blob = await toBlob(canvas, type, quality);
      if (blob.size <= target) return blob;
    }
    if (blob.size <= hardLimit && attempt > 0) return blob;
    size = Math.round(size * 0.8);
  }
  throw new Error('too_large');
}

export async function compress(file) {
  const img = await decode(file);
  // Safari не умеет сохранять WebP и молча отдаёт PNG — тогда берём JPEG.
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const type = probe.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
  return {
    full: await encode(img, 1280, 260_000, LIMITS.fullBytes, type),
    thumb: await encode(img, 520, 45_000, LIMITS.thumbBytes, type),
  };
}

// Небольшая JPEG-копия для нейросети: этого хватает, чтобы узнать вещь.
export async function forAi(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return encode(img, 768, 150_000, 390_000, 'image/jpeg');
}
