import { createServerFn } from '@tanstack/react-start'
import { authorizedFetch } from './api-client'

export interface DocumentImageResponse {
  base64: string
  contentType: string
}

/**
 * Get document thumbnail as base64 - proxies to GET /api/documents/:id/thumbnail
 * This allows the webapp to fetch images from the internal API URL when only
 * the webapp port is exposed in Docker.
 */
export const getDocumentThumbnail = createServerFn({ method: 'POST' })
  .inputValidator((input: { documentId: number }) => input)
  .handler(
    async ({
      data,
    }: {
      data: { documentId: number }
    }): Promise<DocumentImageResponse> => {
      const response = await authorizedFetch(
        `/api/documents/${data.documentId}/thumbnail`,
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch thumbnail: ${response.status}`)
      }

      const buffer = await response.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      const contentType = response.headers.get('Content-Type') || 'image/png'

      return { base64, contentType }
    },
  )

/**
 * Get document image as base64 - proxies to GET /api/documents/:id/image
 * This allows the webapp to fetch images from the internal API URL when only
 * the webapp port is exposed in Docker.
 */
export const getDocumentImage = createServerFn({ method: 'POST' })
  .inputValidator((input: { documentId: number }) => input)
  .handler(
    async ({
      data,
    }: {
      data: { documentId: number }
    }): Promise<DocumentImageResponse> => {
      const response = await authorizedFetch(
        `/api/documents/${data.documentId}/image`,
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`)
      }

      const buffer = await response.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      const contentType =
        response.headers.get('Content-Type') || 'application/pdf'

      return { base64, contentType }
    },
  )
