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
import { usePreviewVendorRename, useRenameVendor } from '@/lib/queries'

interface RenameVendorDialogProps {
  from: string | null
  onOpenChange: (open: boolean) => void
  onRenamed: (from: string, to: string) => void
}

/**
 * Renames a vendor across every receipt it appears on - for a consistent
 * AI misspelling/extraction quirk (e.g. "Carrfeour" instead of
 * "Carrefour"), as opposed to correcting one receipt at a time via the
 * receipt edit dialog. Deliberately not scoped to a specific store
 * location: the vendor name itself is what's wrong, so the fix should
 * apply everywhere that name shows up, regardless of branch.
 */
export function RenameVendorDialog({
  from,
  onOpenChange,
  onRenamed,
}: RenameVendorDialogProps) {
  const [to, setTo] = useState('')
  const { data: preview, isLoading } = usePreviewVendorRename(from)
  const renameVendor = useRenameVendor()

  const handleOpenChange = (open: boolean) => {
    if (!open) setTo('')
    onOpenChange(open)
  }

  const handleConfirm = () => {
    if (!from || !to.trim()) return
    renameVendor.mutate(
      { from, to: to.trim() },
      {
        onSuccess: (result) => {
          toast.success(`Renamed ${result.count} receipt(s) to "${to.trim()}"`)
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
          <DialogTitle>Rename vendor "{from}"</DialogTitle>
          <DialogDescription>
            Renames this vendor across every receipt it appears on, regardless
            of store location.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="rename-vendor-to">New name</Label>
          <Input
            id="rename-vendor-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="e.g. Carrefour"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {isLoading
              ? 'Loading affected receipts...'
              : `Affects ${preview?.length ?? 0} receipt(s):`}
          </Label>
          {preview && preview.length > 0 && (
            <div className="max-h-48 overflow-y-auto border text-xs">
              <table className="w-full">
                <tbody>
                  {preview.map((row) => (
                    <tr key={row.documentId} className="border-b last:border-0">
                      <td className="py-1.5 px-2">
                        {row.fileName ?? `Document ${row.documentId}`}
                      </td>
                      <td className="py-1.5 px-2">
                        {row.storeLocation ?? '—'}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {row.amount !== null
                          ? `${(row.amount / 100).toFixed(2)} ${row.currency ?? ''}`.trim()
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
            disabled={!to.trim() || renameVendor.isPending}
          >
            Rename {preview?.length ?? 0} receipt(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
