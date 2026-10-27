/**
 * Client-side logo prep: 1:1 crop math + canvas export ≤ COMPANY_LOGO_MAX_BYTES.
 * Browser-only (Image / canvas). Import from client components.
 */

import {
  COMPANY_LOGO_MAX_BYTES,
  COMPANY_LOGO_MAX_EDGE,
  COMPANY_LOGO_MIME_TO_EXT,
  COMPANY_LOGO_SOURCE_MAX_BYTES,
} from './company-logo-limits.js';

export function coverScale(natW, natH, viewSize) {
  const w = Number(natW) || 0;
  const h = Number(natH) || 0;
  const v = Number(viewSize) || 1;
  if (w <= 0 || h <= 0) return 1;
  return Math.max(v / w, v / h);
}

/**
 * Clamp pan so the square viewport stays inside the scaled image.
 * @returns {{ panX: number, panY: number }}
 */
export function clampLogoPan(natW, natH, viewSize, zoom, panX, panY) {
  const z = Math.max(1, Number(zoom) || 1);
  const scale = coverScale(natW, natH, viewSize) * z;
  const drawnW = natW * scale;
  const drawnH = natH * scale;
  const maxX = Math.max(0, (drawnW - viewSize) / 2);
  const maxY = Math.max(0, (drawnH - viewSize) / 2);
  return {
    panX: Math.min(maxX, Math.max(-maxX, Number(panX) || 0)),
    panY: Math.min(maxY, Math.max(-maxY, Number(panY) || 0)),
  };
}

/**
 * Source rect in natural image pixels for a 1:1 viewport crop.
 */
export function logoCropSourceRect(natW, natH, viewSize, zoom, panX, panY) {
  const clamped = clampLogoPan(natW, natH, viewSize, zoom, panX, panY);
  const z = Math.max(1, Number(zoom) || 1);
  const scale = coverScale(natW, natH, viewSize) * z;
  const drawnW = natW * scale;
  const drawnH = natH * scale;
  const left = (viewSize - drawnW) / 2 + clamped.panX;
  const top = (viewSize - drawnH) / 2 + clamped.panY;
  const sx = Math.max(0, -left / scale);
  const sy = Math.max(0, -top / scale);
  const sw = Math.min(natW - sx, viewSize / scale);
  const sh = Math.min(natH - sy, viewSize / scale);
  return { sx, sy, sw, sh, panX: clamped.panX, panY: clamped.panY };
}

export function assertLogoSourceFile(file) {
  if (!file || typeof file !== 'object') {
    const err = new Error('INVALID_LOGO_TYPE');
    err.code = 'INVALID_LOGO_TYPE';
    throw err;
  }
  const mime = String(file.type || '')
    .trim()
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (!COMPANY_LOGO_MIME_TO_EXT[mime]) {
    const err = new Error('INVALID_LOGO_TYPE');
    err.code = 'INVALID_LOGO_TYPE';
    throw err;
  }
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    const err = new Error('INVALID_LOGO_SIZE');
    err.code = 'INVALID_LOGO_SIZE';
    throw err;
  }
  if (size > COMPANY_LOGO_SOURCE_MAX_BYTES) {
    const err = new Error('INVALID_LOGO_SOURCE_SIZE');
    err.code = 'INVALID_LOGO_SOURCE_SIZE';
    throw err;
  }
  return { mimeType: mime };
}

/**
 * @param {File|Blob} file
 * @returns {Promise<{ image: HTMLImageElement, objectUrl: string, revoke: () => void }>}
 */
export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const revoke = () => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
    };
    image.onload = () => {
      resolve({ image, objectUrl, revoke });
    };
    image.onerror = () => {
      revoke();
      reject(Object.assign(new Error('INVALID_LOGO_TYPE'), { code: 'INVALID_LOGO_TYPE' }));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || null), type, quality);
  });
}

/**
 * Draw 1:1 crop and compress until ≤ max bytes (WebP then JPEG).
 * @returns {Promise<File>}
 */
export async function exportCroppedLogoFile(img, { viewSize, zoom, panX, panY, edge = COMPANY_LOGO_MAX_EDGE } = {}) {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  const { sx, sy, sw, sh } = logoCropSourceRect(natW, natH, viewSize, zoom, panX, panY);
  let out = Math.min(Math.max(64, Number(edge) || COMPANY_LOGO_MAX_EDGE), COMPANY_LOGO_MAX_EDGE);

  const tryExport = async (size) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);

    for (const type of ['image/webp', 'image/jpeg']) {
      for (let q = 0.92; q >= 0.45; q -= 0.07) {
        const blob = await canvasToBlob(canvas, type, q);
        if (blob && blob.size <= COMPANY_LOGO_MAX_BYTES) {
          const ext = type === 'image/webp' ? 'webp' : 'jpg';
          return new File([blob], `company-logo.${ext}`, { type });
        }
      }
    }
    return null;
  };

  let file = await tryExport(out);
  while (!file && out > 256) {
    out = Math.floor(out * 0.75);
    file = await tryExport(out);
  }
  if (!file) {
    const err = new Error('INVALID_LOGO_SIZE');
    err.code = 'INVALID_LOGO_SIZE';
    throw err;
  }
  return file;
}
