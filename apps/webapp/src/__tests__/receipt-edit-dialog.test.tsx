import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  useDeleteReceipt,
  useDeleteReceiptItem,
  useReceiptDetail,
  useUpdateReceipt,
  useUpdateReceiptItem,
} from '../lib/queries'
import { ReceiptEditDialog } from '../components/receipts/receipt-edit-dialog'
import { createTestQueryClient } from './setup'
import type * as QueriesModule from '../lib/queries'
import type {
  ProcessingLogEntry,
  ReceiptDetail,
} from '../lib/server/receipts.functions'
import type { ReceiptItemEntry } from '../lib/server/items.functions'
import type * as DndKitCoreModule from '@dnd-kit/core'
import type { ReactNode } from 'react'

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof DndKitCoreModule>()
  return {
    ...actual,
    // jsdom can't simulate real pointer-drag sequences, so this test
    // exposes a button that fires the same onDragEnd callback dnd-kit
    // would call after a real drag, letting the reorder logic itself be
    // exercised without faking pointer events.
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: ReactNode
      onDragEnd: (event: {
        active: { id: number }
        over: { id: number } | null
      }) => void
    }) => (
      <div>
        <button
          type="button"
          onClick={() => onDragEnd({ active: { id: 101 }, over: { id: 102 } })}
        >
          simulate drag almond milk over refund item
        </button>
        {children}
      </div>
    ),
  }
})

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>()
  return {
    ...actual,
    useReceiptDetail: vi.fn(),
    useUpdateReceipt: vi.fn(),
    useDeleteReceipt: vi.fn(),
    useUpdateReceiptItem: vi.fn(),
    useDeleteReceiptItem: vi.fn(),
  }
})

const mockUseReceiptDetail = useReceiptDetail as ReturnType<typeof vi.fn>
const mockUseUpdateReceipt = useUpdateReceipt as ReturnType<typeof vi.fn>
const mockUseDeleteReceipt = useDeleteReceipt as ReturnType<typeof vi.fn>
const mockUseUpdateReceiptItem = useUpdateReceiptItem as ReturnType<
  typeof vi.fn
>
const mockUseDeleteReceiptItem = useDeleteReceiptItem as ReturnType<
  typeof vi.fn
>

const DOCUMENT_ID = 42

const mockLog: ProcessingLogEntry = {
  id: 1,
  documentId: DOCUMENT_ID,
  status: 'completed',
  fileName: 'receipt.jpg',
  vendor: 'Carrefour',
  amount: 950,
  currency: 'AED',
  storeLocation: 'Mall of the Emirates',
  receiptData: JSON.stringify({
    date: '2026-01-05',
    time: '14:30',
    category: 'groceries',
  }),
  updatedAt: '2026-01-05T14:30:00.000Z',
}

const goodItem: ReceiptItemEntry = {
  id: 101,
  documentId: DOCUMENT_ID,
  isSighting: false,
  vendor: 'Carrefour',
  itemName: 'almond milk 1l',
  canonicalName: 'Almond Milk',
  quantity: 2,
  unitPrice: 500,
  totalPrice: 1000,
  totalSize: 2000,
  sizeUnit: 'ml',
  currency: 'AED',
  purchaseDate: '2026-01-05',
  purchaseTime: null,
  storeLocation: 'Mall of the Emirates',
  sortOrder: 0,
  createdAt: '2026-01-05T14:30:00.000Z',
}

const refundItem: ReceiptItemEntry = {
  id: 102,
  documentId: DOCUMENT_ID,
  isSighting: false,
  vendor: 'Carrefour',
  itemName: 'discount',
  canonicalName: null,
  quantity: 1,
  unitPrice: null,
  totalPrice: -50,
  totalSize: null,
  sizeUnit: null,
  currency: 'AED',
  purchaseDate: '2026-01-05',
  purchaseTime: null,
  storeLocation: 'Mall of the Emirates',
  sortOrder: 1,
  createdAt: '2026-01-05T14:30:00.000Z',
}

const mockDetail: ReceiptDetail = {
  log: mockLog,
  items: [goodItem, refundItem],
}

function setupDefaultMocks() {
  mockUseReceiptDetail.mockReturnValue({ data: mockDetail, isLoading: false })
  mockUseUpdateReceipt.mockReturnValue({
    mutate: vi.fn((_vars, opts) => opts?.onSuccess?.()),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  })
  mockUseDeleteReceipt.mockReturnValue({
    mutate: vi.fn((_vars, opts) => opts?.onSuccess?.()),
    isPending: false,
  })
  mockUseUpdateReceiptItem.mockReturnValue({
    mutate: vi.fn((_vars, opts) => opts?.onSuccess?.()),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  })
  mockUseDeleteReceiptItem.mockReturnValue({
    mutate: vi.fn((_vars, opts) => opts?.onSuccess?.()),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  })
}

function renderDialog(onOpenChange: (open: boolean) => void = vi.fn()) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ReceiptEditDialog documentId={DOCUMENT_ID} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
}

async function enterEditMode() {
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
}

async function clickSave() {
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('ReceiptEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('renders receipt fields and flags a non-positive-price item for review', () => {
    renderDialog()

    expect(screen.getByText('Carrefour')).toBeInTheDocument()
    expect(screen.getByText('Mall of the Emirates')).toBeInTheDocument()
    expect(screen.getByText('2026-01-05')).toBeInTheDocument()
    expect(screen.getByText('Almond Milk')).toBeInTheDocument()
    expect(screen.getByText('Needs review')).toBeInTheDocument()
  })

  it('reveals editable inputs for the receipt and its items after clicking Edit', async () => {
    renderDialog()
    await enterEditMode()

    expect(screen.getByDisplayValue('Carrefour')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Mall of the Emirates')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Almond Milk')).toBeInTheDocument()
    expect(screen.getByDisplayValue('10.00')).toBeInTheDocument()
  })

  it('shows Cancel and a single Save button (not one per item) while editing', async () => {
    renderDialog()
    await enterEditMode()

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
  })

  it('rejects saving the receipt with an empty store name', async () => {
    renderDialog()
    await enterEditMode()

    fireEvent.change(screen.getByDisplayValue('Carrefour'), {
      target: { value: '' },
    })
    await clickSave()

    expect(toast.error).toHaveBeenCalledWith('Store name cannot be empty')
    expect(mockUseUpdateReceipt().mutateAsync).not.toHaveBeenCalled()
  })

  it('rejects saving the receipt with an empty date', async () => {
    renderDialog()
    await enterEditMode()

    fireEvent.change(screen.getByDisplayValue('2026-01-05'), {
      target: { value: '' },
    })
    await clickSave()

    expect(toast.error).toHaveBeenCalledWith('Date cannot be empty')
    expect(mockUseUpdateReceipt().mutateAsync).not.toHaveBeenCalled()
  })

  it('rejects saving the receipt with an empty currency', async () => {
    renderDialog()
    await enterEditMode()

    fireEvent.change(screen.getByDisplayValue('AED'), {
      target: { value: '' },
    })
    await clickSave()

    expect(toast.error).toHaveBeenCalledWith('Currency cannot be empty')
    expect(mockUseUpdateReceipt().mutateAsync).not.toHaveBeenCalled()
  })

  it('saves valid receipt edits with the exact edited field values, without touching unchanged items', async () => {
    renderDialog()
    await enterEditMode()

    fireEvent.change(screen.getByDisplayValue('Mall of the Emirates'), {
      target: { value: 'Downtown Branch' },
    })
    await clickSave()

    expect(mockUseUpdateReceipt().mutateAsync).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      edits: {
        vendor: 'Carrefour',
        storeLocation: 'Downtown Branch',
        date: '2026-01-05',
        time: '14:30',
        currency: 'AED',
        category: 'groceries',
        taxAmount: null,
      },
    })
    expect(mockUseUpdateReceiptItem().mutateAsync).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Receipt updated'),
    )
  })

  it('arms then deletes the receipt on a second click, closing the dialog', async () => {
    const onOpenChange = vi.fn()
    renderDialog(onOpenChange)
    await enterEditMode()

    const deleteButton = screen.getByRole('button', { name: /delete receipt/i })
    await userEvent.click(deleteButton)
    expect(mockUseDeleteReceipt().mutate).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /click again to delete/i }),
    ).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: /click again to delete/i }),
    )

    expect(mockUseDeleteReceipt().mutate).toHaveBeenCalledWith(
      { documentId: DOCUMENT_ID },
      expect.anything(),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('rejects saving when an item name is cleared', async () => {
    renderDialog()
    await enterEditMode()

    fireEvent.change(screen.getByDisplayValue('Almond Milk'), {
      target: { value: '' },
    })
    await clickSave()

    expect(toast.error).toHaveBeenCalledWith(
      'Item name cannot be empty (row 1)',
    )
    expect(mockUseUpdateReceiptItem().mutateAsync).not.toHaveBeenCalled()
    expect(mockUseUpdateReceipt().mutateAsync).not.toHaveBeenCalled()
  })

  it('rejects saving when an item quantity is zero', async () => {
    renderDialog()
    await enterEditMode()

    fireEvent.change(screen.getByDisplayValue('2'), {
      target: { value: '0' },
    })
    await clickSave()

    expect(toast.error).toHaveBeenCalledWith(
      '"Almond Milk": quantity must be a positive number',
    )
    expect(mockUseUpdateReceiptItem().mutateAsync).not.toHaveBeenCalled()
  })

  it('saves a blank item price as null instead of rejecting it as invalid', async () => {
    renderDialog()
    await enterEditMode()

    fireEvent.change(screen.getByDisplayValue('10.00'), {
      target: { value: '' },
    })
    await clickSave()

    expect(toast.error).not.toHaveBeenCalled()
    expect(mockUseUpdateReceiptItem().mutateAsync).toHaveBeenCalledWith({
      id: goodItem.id,
      edits: expect.objectContaining({ totalPrice: null }),
    })
  })

  it('omits canonicalName from the item update when only another field changed', async () => {
    renderDialog()
    await enterEditMode()

    fireEvent.change(screen.getByDisplayValue('2'), {
      target: { value: '3' },
    })
    await clickSave()

    const [payload] = mockUseUpdateReceiptItem().mutateAsync.mock.calls[0]
    expect(payload.edits).not.toHaveProperty('canonicalName')
    expect(payload.edits.quantity).toBe(3)
  })

  it('sends canonicalName once the item name is edited', async () => {
    renderDialog()
    await enterEditMode()

    fireEvent.change(screen.getByDisplayValue('Almond Milk'), {
      target: { value: 'Oat Milk' },
    })
    await clickSave()

    const [payload] = mockUseUpdateReceiptItem().mutateAsync.mock.calls[0]
    expect(payload.edits.canonicalName).toBe('Oat Milk')
  })

  it('rejects a zero total size but allows clearing it entirely (clears the unit too)', async () => {
    renderDialog()
    await enterEditMode()

    const sizeInput = screen.getByDisplayValue('2000')
    fireEvent.change(sizeInput, { target: { value: '0' } })
    await clickSave()
    expect(toast.error).toHaveBeenCalledWith(
      '"Almond Milk": total size must be a positive number, or left blank',
    )
    expect(mockUseUpdateReceiptItem().mutateAsync).not.toHaveBeenCalled()

    fireEvent.change(sizeInput, { target: { value: '' } })
    await clickSave()

    const [payload] = mockUseUpdateReceiptItem().mutateAsync.mock.calls[0]
    expect(payload.edits.totalSize).toBeNull()
    expect(payload.edits.sizeUnit).toBeNull()
  })

  it('dragging an item to a new position sends updated sortOrder for both on save', async () => {
    renderDialog()
    await enterEditMode()

    await userEvent.click(
      screen.getByRole('button', {
        name: /simulate drag almond milk over refund item/i,
      }),
    )
    await clickSave()

    const calls = mockUseUpdateReceiptItem().mutateAsync.mock.calls
    const goodItemCall = calls.find(
      ([payload]: [any]) => payload.id === goodItem.id,
    )
    const refundItemCall = calls.find(
      ([payload]: [any]) => payload.id === refundItem.id,
    )
    expect(goodItemCall?.[0].edits.sortOrder).toBe(1)
    expect(refundItemCall?.[0].edits.sortOrder).toBe(0)
  })

  it('arms then removes a single line item from the list on a second click, without saving to the server yet', async () => {
    renderDialog()
    await enterEditMode()

    const deleteButton = screen.getByRole('button', {
      name: 'Delete Almond Milk',
    })
    await userEvent.click(deleteButton)
    expect(mockUseDeleteReceiptItem().mutateAsync).not.toHaveBeenCalled()

    await userEvent.click(
      screen.getByRole('button', { name: 'Click again to delete Almond Milk' }),
    )

    expect(screen.queryByDisplayValue('Almond Milk')).not.toBeInTheDocument()
    expect(mockUseDeleteReceiptItem().mutateAsync).not.toHaveBeenCalled()
  })

  it('only deletes a removed line item from the server once Save is clicked', async () => {
    renderDialog()
    await enterEditMode()

    await userEvent.click(
      screen.getByRole('button', { name: 'Delete Almond Milk' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Click again to delete Almond Milk' }),
    )
    expect(mockUseDeleteReceiptItem().mutateAsync).not.toHaveBeenCalled()

    await clickSave()

    expect(mockUseDeleteReceiptItem().mutateAsync).toHaveBeenCalledWith({
      id: goodItem.id,
    })
  })

  it('shows a debounced review warning once the user pauses on a non-positive price', async () => {
    renderDialog()
    await enterEditMode()

    fireEvent.change(screen.getByDisplayValue('10.00'), {
      target: { value: '-5' },
    })

    await waitFor(
      () =>
        expect(screen.getByText(/zero or negative price/i)).toBeInTheDocument(),
      { timeout: 1000 },
    )
  })
})
