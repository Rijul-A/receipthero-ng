import { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/bun'
import { broadcastHub } from '../lib/broadcast'
import { createLogger } from '@sm-rn/core'
import { isTokenAuthorized } from '../middleware/require-auth'

const logger = createLogger('ws')
const ws = new Hono()

ws.get(
  '/',
  // Browsers can't set custom headers on a WebSocket upgrade request, so
  // the session token rides as a query param here instead of the usual
  // Authorization header.
  async (c, next) => {
    const token = c.req.query('token')
    if (!token || !(await isTokenAuthorized(token))) {
      return c.text('Unauthorized', 401)
    }
    await next()
  },
  upgradeWebSocket((_c) => {
    return {
      onOpen(event, ws) {
        logger.debug('Client connected')
        const onAppEvent = (data: any) => {
          ws.send(JSON.stringify(data))
        }

        broadcastHub.on('app:event', onAppEvent)

        // Store listener for cleanup
        ;(ws as any)._onAppEvent = onAppEvent
      },
      onClose(event, ws) {
        logger.debug('Client disconnected')
        const listener = (ws as any)._onAppEvent
        if (listener) {
          broadcastHub.off('app:event', listener)
        }
      },
    }
  }),
)

export default ws
