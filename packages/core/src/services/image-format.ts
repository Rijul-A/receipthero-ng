/**
 * Detects an image's MIME type from its magic bytes rather than trusting an
 * assumed format. Paperless-ngx thumbnails are WebP by default and originals
 * can be PNG, so mislabeling a data URI's declared type causes stricter
 * decoders (e.g. Ollama's backend) to reject an otherwise-valid image.
 */
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export function detectImageMimeType(base64: string): ImageMimeType {
  const header = Buffer.from(base64.slice(0, 16), 'base64');

  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'image/jpeg';
  }
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
    return 'image/png';
  }
  if (
    header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
    header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
    return 'image/gif';
  }

  return 'image/jpeg';
}
