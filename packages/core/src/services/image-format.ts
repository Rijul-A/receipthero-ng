import sharp from 'sharp'

export type ImageMimeType = 'image/jpeg' | 'image/png'

/**
 * Detects an image's format from its magic bytes rather than trusting an
 * assumed format.
 */
function detectFormat(buffer: Buffer): 'jpeg' | 'png' | 'webp' | 'gif' | 'unknown' {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
    return 'png'
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  )
    return 'webp'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif'
  return 'unknown'
}

/**
 * Prepares an image buffer for a vision model: JPEG/PNG are passed through
 * unchanged, anything else (WebP, GIF, etc. — notably Paperless-ngx's default
 * thumbnail format) is transcoded to JPEG, since most vision model backends
 * (Ollama/llama.cpp's stb_image-based decoder in particular) only support
 * JPEG/PNG regardless of how the data URI is labeled.
 */
export async function normalizeImageForVision(
  buffer: Buffer,
): Promise<{ base64: string; mimeType: ImageMimeType }> {
  const format = detectFormat(buffer)

  if (format === 'jpeg') {
    return { base64: buffer.toString('base64'), mimeType: 'image/jpeg' }
  }
  if (format === 'png') {
    return { base64: buffer.toString('base64'), mimeType: 'image/png' }
  }

  const jpeg = await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
  return { base64: jpeg.toString('base64'), mimeType: 'image/jpeg' }
}
