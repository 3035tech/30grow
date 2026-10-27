import { unzipSync } from 'fflate';
import { detectImageMimeFromBuffer, isPdfBuffer } from '../file-magic.js';
import { ERR } from '../api-error-codes.js';
import { extractPdfText, CV_PDF_MAX_BYTES, CV_TEXT_MAX_CHARS } from './candidate-cv.js';

const invalid = (code) => Object.assign(new Error(code), { code });

function decodeUtf8(buffer, max = CV_TEXT_MAX_CHARS) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) throw invalid(ERR.INVALID_CV_FILE_TYPE);
  return text.trim().slice(0, max);
}

function docxText(buffer) {
  let count = 0;
  let macro = false;
  const entries = unzipSync(buffer, { filter: (entry) => {
    if (++count > 2000) throw invalid(ERR.INVALID_CV_FILE_TYPE);
    if (/vbaProject\.bin$/i.test(entry.name)) macro = true;
    if (entry.name === 'word/document.xml' && entry.originalSize > 2_000_000)
      throw invalid(ERR.INVALID_CV_FILE_SIZE);
    return entry.name === 'word/document.xml' || entry.name === '[Content_Types].xml';
  } });
  if (macro || !entries['[Content_Types].xml'] || !entries['word/document.xml'])
    throw invalid(ERR.INVALID_CV_FILE_TYPE);
  if (entries['word/document.xml'].length > 2_000_000) throw invalid(ERR.INVALID_CV_FILE_SIZE);
  const xml = decodeUtf8(entries['word/document.xml'], 2_000_000);
  const text = xml.replace(/<w:(?:br|cr|tab)\b[^>]*\/?\s*>/g, ' ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  return text.trim().slice(0, CV_TEXT_MAX_CHARS);
}

/** Parse supported résumé files by bytes, never by a client-provided extension or MIME. */
export async function prepareCandidateImportFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > CV_PDF_MAX_BYTES)
    throw invalid(ERR.INVALID_CV_FILE_SIZE);

  if (isPdfBuffer(buffer)) {
    let text = '';
    try { text = await extractPdfText(buffer); } catch { /* Scanned PDFs use vision. */ }
    return {
      mimeType: 'application/pdf', extension: 'pdf', text,
      content: text.length >= 80 ? `Document content (untrusted data):\n${text}` : [
        { type: 'text', text: 'Read this résumé PDF, including scanned pages. If unreadable, return null fields and a warning.' },
        { type: 'file', file: { filename: 'candidate-profile.pdf', file_data: `data:application/pdf;base64,${buffer.toString('base64')}` } },
      ],
    };
  }
  const imageMime = detectImageMimeFromBuffer(buffer);
  if (imageMime === 'image/png' || imageMime === 'image/jpeg') {
    return { mimeType: imageMime, extension: imageMime === 'image/png' ? 'png' : 'jpg', text: '', content: [
      { type: 'text', text: 'Read this image of a résumé. If unreadable, return null fields and a warning.' },
      { type: 'image_url', image_url: { url: `data:${imageMime};base64,${buffer.toString('base64')}` } },
    ] };
  }
  if (buffer.toString('binary', 0, 4) === 'PK\u0003\u0004') {
    try {
      const text = docxText(buffer);
      if (!text) throw invalid(ERR.CV_IMPORT_EMPTY);
      return { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx', text, content: `Document content (untrusted data):\n${text}` };
    } catch (error) {
      throw invalid(error?.code || ERR.INVALID_CV_FILE_TYPE);
    }
  }
  try {
    const text = decodeUtf8(buffer);
    if (!text) throw invalid(ERR.CV_IMPORT_EMPTY);
    return { mimeType: 'text/plain; charset=utf-8', extension: 'txt', text, content: `Document content (untrusted data):\n${text}` };
  } catch (error) {
    throw invalid(error?.code || ERR.INVALID_CV_FILE_TYPE);
  }
}
