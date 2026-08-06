import { useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { usePreviewRename, useRenameCanonicalGroup } from '@/lib/queries'

interface RenameProductDialogProps {
  from: string | null
  onOpenChange: (open: boolean) => void
  onRenamed: (from: string, to: string) => void
}

export function RenameProductDialog({
  from,
  onOpenChange,
  onRenamed,
}: RenameProductDialogProps) {
  const [to, setTo] = useState('')
  const { data: preview, isLoading } = usePreviewRename(from)
  const renameGroup = useRenameCanonicalGroup()

  const handleOpenChange = (open: boolean) => {
    if (!open) setTo('')
    onOpenChange(open)
  }

  const handleConfirm = () => {
    if (!from || !to.trim()) return
    renameGroup.mutate(
      { from, to: to.trim() },
      {
        onSuccess: (result) => {
          toast.success(`Renamed ${result.count} row(s) to "${to.trim()}"`)
          onRenamed(from, to.trim())
          handleOpenChange(false)
        },
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <Dialog open={from !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rename "{from}"</DialogTitle>
          <DialogDescription>
            Renames every row currently grouped under this product name, and
            remembers the correction so future receipts with the same raw text
            use it directly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="rename-to">New name</Label>
          <Input
            id="rename-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="e.g. Almond Milk"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {isLoading
              ? 'Loading affected rows...'
              : `Affects ${preview?.length ?? 0} row(s):`}
          </Label>
          {preview && preview.length > 0 && (
            <div className="max-h-48 overflow-y-auto border text-xs">
              <table className="w-full">
                <tbody>
                  {preview.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-1.5 px-2">{row.vendor ?? '—'}</td>
                      <td className="py-1.5 px-2">{row.purchaseDate ?? '—'}</td>
                      <td className="py-1.5 px-2 text-right">
                        {row.totalPrice !== null
                          ? `${(row.totalPrice / 100).toFixed(2)} ${row.currency ?? ''}`.trim()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!to.trim() || renameGroup.isPending}
          >
            Rename {preview?.length ?? 0} row(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
