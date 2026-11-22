'use strict';
// Texto de la captura de un ticket con Tesseract (tesseract.js, gratuito y dentro del contenedor: ni APIs de pago ni la imagen
// sale de aquí). El idioma va en el paquete @tesseract.js-data/spa, así que no se descarga nada al usarlo. La imagen no se
// guarda: se lee y se olvida. Un solo lector a la vez (cada captura tarda ~1 s y usa bastante memoria) y se cierra si nadie lo
// usa en unos minutos, para no dejar esa memoria ocupada.
const path = require('path');

const IDLE = 3 * 60e3;
let worker = null, closing = null, chain = Promise.resolve();

async function getWorker() {
  if (closing) clearTimeout(closing);
  closing = setTimeout(() => { const w = worker; worker = null; if (w) w.then(x => x.terminate()).catch(() => {}); }, IDLE);
  closing.unref?.();
  if (!worker) {
    const { createWorker } = require('tesseract.js');
    const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/spa/package.json')), '4.0.0_best_int');
    worker = createWorker('spa', 1, { langPath, cacheMethod: 'none', gzip: true, logger: () => {} });
    worker.catch(() => { worker = null; });
  }
  return worker;
}

// PNG, JPEG o WebP por su firma: no se acepta otra cosa
function imageOf(dataUrl) {
  const b64 = String(dataUrl || '').replace(/^data:image\/[a-z+]+;base64,/i, '');
  const buf = Buffer.from(b64, 'base64');
  const png = buf[0] === 0x89 && buf[1] === 0x50, jpg = buf[0] === 0xff && buf[1] === 0xd8, webp = buf.slice(8, 12).toString() === 'WEBP';
  if (buf.length < 100 || !(png || jpg || webp)) throw Object.assign(new Error('Eso no parece una imagen: sube una captura en PNG o JPG'), { status: 400 });
  if (buf.length > 8e6) throw Object.assign(new Error('La imagen pesa demasiado (más de 8 MB)'), { status: 413 });
  return buf;
}

// → el texto de la imagen. De una en una: las que lleguen a la vez esperan su turno
function read(dataUrl) {
  const buf = imageOf(dataUrl);
  const job = chain.then(async () => (await (await getWorker()).recognize(buf)).data.text);
  chain = job.catch(() => {});
  return job;
}

module.exports = { read, imageOf };
