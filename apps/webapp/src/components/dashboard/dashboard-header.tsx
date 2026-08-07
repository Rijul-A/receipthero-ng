import { Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useExportReceiptsCsv } from '@/lib/queries'

interface DashboardHeaderProps {
  lastRefresh: Date | null
  onRefresh: () => void
  isRefreshing: boolean
  isTriggeringScan: boolean
}

export function DashboardHeader({
  lastRefresh,
  onRefresh,
  isRefreshing,
  isTriggeringScan,
}: DashboardHeaderProps) {
  const exportReceiptsCsv = useExportReceiptsCsv()

  const handleExport = () => {
    exportReceiptsCsv.mutate(undefined, {
      onError: (error) => toast.error(error.message),
    })
  }

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).format(date)
  }

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          ReceiptHero Dashboard
        </h1>
        <p className="text-muted-foreground">
          Paperless-NGX Integration & Worker Status
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {lastRefresh && (
          <span className="text-sm text-muted-foreground hidden md:inline-block">
            Last updated: {formatTime(lastRefresh)}
          </span>
        )}
        <Button
          variant={isTriggeringScan ? 'secondary' : 'outline'}
          size="sm"
          onClick={onRefresh}
          disabled={isTriggeringScan || isRefreshing}
        >
          <RefreshCw
            className={cn(
              'h-4 w-4 mr-2',
              (isTriggeringScan || isRefreshing) && 'animate-spin',
            )}
          />
          {isTriggeringScan ? 'Scanning...' : 'Refresh'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exportReceiptsCsv.isPending}
        >
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>
    </div>
  )
}
