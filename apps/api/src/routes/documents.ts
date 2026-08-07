import { Hono } from 'hono'
import { loadConfig, PaperlessClient } from '@sm-rn/core'

const documents = new Hono()

// GET /api/documents/:id/thumbnail - Get thumbnail
documents.get('/:id/thumbnail', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  try {
    const config = loadConfig()
    const client = new PaperlessClient({
      host: config.paperless.host,
      apiKey: config.paperless.apiKey,
      processedTagName: config.processing.processedTag,
    })

    const buffer = await client.getDocumentThumbnail(id)
    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

export default documents
