import { useEffect, useState } from 'react'
import { Loader2, Pause, Play, RotateCcw, Trash2 } from 'lucide-react'
import type { HealthStatus } from '@/lib/queries'
import type { QueueItem } from '@/lib/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface WorkerControlCardProps {
  worker: HealthStatus['worker'] | undefined
  stats: HealthStatus['stats'] | undefined
  queueItems: Array<QueueItem> | undefined
  onPause: () => void
  onResume: () => void
  onRetryAll: () => void
  onClearQueue: () => void
  isPausingWorker: boolean
  isResumingWorker: boolean
  isRetryingAll: boolean
  isClearingQueue: boolean
}

// Renders as "ready" once nextRetryAt has passed, otherwise a compact
// countdown (e.g. "2m 14s") - ticks via the caller re-rendering this every
// second rather than computing once and going stale.
function formatCountdown(nextRetryAt: string, now: number): string {
  const remainingMs = new Date(nextRetryAt).getTime() - now
  if (remainingMs <= 0) return 'ready'

  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

export function WorkerControlCard({
  worker,
  stats,
  queueItems,
  onPause,
  onResume,
  onRetryAll,
  onClearQueue,
  isPausingWorker,
  isResumingWorker,
  isRetryingAll,
  isClearingQueue,
}: WorkerControlCardProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!queueItems?.length) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [queueItems?.length])
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Worker Control
          </CardTitle>
          {worker?.isPaused ? (
            <Badge
              variant="secondary"
              className="bg-yellow-100 text-yellow-800"
            >
              <Pause className="h-3 w-3 mr-1" /> Paused
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-green-100 text-green-800">
              <Play className="h-3 w-3 mr-1" /> Running
            </Badge>
          )}
        </div>
        {worker?.isPaused && worker.pauseReason && (
          <p className="text-xs text-muted-foreground mt-1">
            Reason: {worker.pauseReason}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {worker?.isPaused ? (
            <Button size="sm" onClick={onResume} disabled={isResumingWorker}>
              {isResumingWorker ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Resume Worker
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={onPause}
              disabled={isPausingWorker}
            >
              {isPausingWorker ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Pause className="h-4 w-4 mr-2" />
              )}
              Pause Worker
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={onRetryAll}
            disabled={isRetryingAll || !stats?.inQueue}
          >
            {isRetryingAll ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Retry All ({stats?.inQueue || 0})
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={onClearQueue}
            disabled={isClearingQueue || !stats?.inQueue}
          >
            {isClearingQueue ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Clear Queue
          </Button>
        </div>

        {queueItems && queueItems.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {queueItems.map((item) => (
              <li
                key={item.documentId}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  Document {item.documentId} (attempt {item.attempts})
                </span>
                <Badge variant="outline" className="shrink-0 font-mono">
                  {formatCountdown(item.nextRetryAt, now)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
