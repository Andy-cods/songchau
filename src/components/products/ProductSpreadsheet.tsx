import { useState, useRef, useEffect, useCallback } from 'react'
import { Save, Undo2, Plus, Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/api'

// Column definition
interface Column {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  width: string
  options?: string[]
  required?: boolean
  mono?: boolean
}

const COLUMNS: Column[] = [
  { key: 'partNumber', label: 'Mã SP', type: 'text', width: 'w-[140px] min-w-[140px]', required: true, mono: true },
  { key: 'name', label: 'Tên SP', type: 'text', width: 'w-[180px] min-w-[180px]', required: true },
  { key: 'category', label: 'Loại', type: 'text', width: 'w-[100px] min-w-[100px]', required: true },
  { key: 'brand', label: 'Thương hiệu', type: 'text', width: 'w-[120px] min-w-[120px]' },
  { key: 'machineModel', label: 'Model máy', type: 'text', width: 'w-[140px] min-w-[140px]' },
  { key: 'material', label: 'Vật liệu', type: 'select', width: 'w-[110px] min-w-[110px]', options: ['', 'CERAMIC', 'METAL', 'RUBBER', 'O-RING'] },
  { key: 'size', label: 'Kích thước', type: 'text', width: 'w-[100px] min-w-[100px]', mono: true },
  { key: 'remark', label: 'Ghi chú', type: 'text', width: 'w-[140px] min-w-[140px]' },
  { key: 'costPrice', label: 'Giá nhập', type: 'number', width: 'w-[110px] min-w-[110px]' },
  { key: 'sellingPrice', label: 'Giá bán', type: 'number', width: 'w-[110px] min-w-[110px]' },
  { key: 'stockQuantity', label: 'Tồn kho', type: 'number', width: 'w-[80px] min-w-[80px]' },
  { key: 'status', label: 'Trạng thái', type: 'select', width: 'w-[100px] min-w-[100px]', options: ['active', 'inactive'] },
]

type EditingCell = { rowId: number | 'new'; colIndex: number } | null

interface Props {
  products: Product[]
  isLoading: boolean
  onUpdate: (id: number, data: Partial<Product>) => Promise<any>
  onCreate: (data: Partial<Product>) => Promise<any>
  onDelete?: (id: number) => Promise<any>
}

const EMPTY_NEW_ROW: Record<string, any> = {
  partNumber: '',
  name: '',
  category: 'nozzle',
  brand: '',
  machineModel: '',
  material: '',
  size: '',
  remark: '',
  costPrice: '',
  sellingPrice: '',
  stockQuantity: '',
  status: 'active',
}

export default function ProductSpreadsheet({ products, isLoading, onUpdate, onCreate, onDelete }: Props) {
  const [editingCell, setEditingCell] = useState<EditingCell>(null)
  const [dirtyRows, setDirtyRows] = useState<Map<number | 'new', Record<string, any>>>(new Map())
  const [savingRows, setSavingRows] = useState<Set<number | 'new'>>(new Set())
  const [newRowData, setNewRowData] = useState<Record<string, any>>({ ...EMPTY_NEW_ROW })
  const [showNewRow, setShowNewRow] = useState(false)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  // Auto-focus input when editing cell changes
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select()
      }
    }
  }, [editingCell])

  // Get display value for a cell
  const getCellValue = useCallback((product: Product | Record<string, any>, key: string): string => {
    const val = (product as any)[key]
    if (val === null || val === undefined || val === '') return ''
    if (typeof val === 'number') return String(val)
    return String(val)
  }, [])

  // Get the current value considering dirty state
  const getDisplayValue = useCallback((rowId: number | 'new', product: Product | Record<string, any>, key: string): string => {
    const dirty = dirtyRows.get(rowId)
    if (dirty && key in dirty) return String(dirty[key] ?? '')
    if (rowId === 'new') return String((newRowData as any)[key] ?? '')
    return getCellValue(product, key)
  }, [dirtyRows, newRowData, getCellValue])

  // Format number for display
  const formatNumber = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined || val === '') return ''
    const num = Number(val)
    if (isNaN(num)) return String(val)
    return num.toLocaleString('vi-VN')
  }

  // Start editing a cell
  const startEditing = (rowId: number | 'new', colIndex: number) => {
    if (savingRows.has(rowId)) return
    setEditingCell({ rowId, colIndex })
  }

  // Commit current cell value to dirty state
  const commitCellValue = (rowId: number | 'new', key: string, value: string) => {
    const col = COLUMNS.find(c => c.key === key)
    let parsedValue: any = value

    if (col?.type === 'number') {
      parsedValue = value === '' ? null : Number(value)
      if (value !== '' && isNaN(parsedValue)) {
        setErrors(prev => new Map(prev).set(`${rowId}:${key}`, 'Số không hợp lệ'))
        return
      }
    }

    // Clear error
    setErrors(prev => {
      const next = new Map(prev)
      next.delete(`${rowId}:${key}`)
      return next
    })

    if (rowId === 'new') {
      setNewRowData(prev => ({ ...prev, [key]: parsedValue }))
    } else {
      // Check if value actually changed from original
      const product = products.find(p => p.id === rowId)
      const originalValue = product ? (product as any)[key] : undefined
      const isChanged = parsedValue !== originalValue && !(parsedValue === null && (originalValue === null || originalValue === undefined || originalValue === ''))

      setDirtyRows(prev => {
        const next = new Map(prev)
        const existing = next.get(rowId) || {}

        if (isChanged) {
          next.set(rowId, { ...existing, [key]: parsedValue })
        } else {
          // Remove this key if it reverted to original
          const { [key]: _, ...rest } = existing
          if (Object.keys(rest).length === 0) {
            next.delete(rowId)
          } else {
            next.set(rowId, rest)
          }
        }
        return next
      })
    }
  }

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent, rowId: number | 'new', colIndex: number) => {
    const key = COLUMNS[colIndex].key

    if (e.key === 'Tab') {
      e.preventDefault()
      // Commit current value
      const input = inputRef.current
      if (input) commitCellValue(rowId, key, input.value)

      const nextCol = e.shiftKey ? colIndex - 1 : colIndex + 1

      if (nextCol >= 0 && nextCol < COLUMNS.length) {
        setEditingCell({ rowId, colIndex: nextCol })
      } else if (!e.shiftKey && nextCol >= COLUMNS.length) {
        // Move to next row
        if (rowId === 'new') {
          setEditingCell(null)
        } else {
          const currentIdx = products.findIndex(p => p.id === rowId)
          const nextProduct = products[currentIdx + 1]
          if (nextProduct) {
            setEditingCell({ rowId: nextProduct.id, colIndex: 0 })
          } else if (showNewRow) {
            setEditingCell({ rowId: 'new', colIndex: 0 })
          } else {
            setEditingCell(null)
          }
        }
      } else if (e.shiftKey && nextCol < 0) {
        // Move to previous row, last column
        if (rowId === 'new') {
          const lastProduct = products[products.length - 1]
          if (lastProduct) {
            setEditingCell({ rowId: lastProduct.id, colIndex: COLUMNS.length - 1 })
          }
        } else {
          const currentIdx = products.findIndex(p => p.id === rowId)
          const prevProduct = products[currentIdx - 1]
          if (prevProduct) {
            setEditingCell({ rowId: prevProduct.id, colIndex: COLUMNS.length - 1 })
          }
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const input = inputRef.current
      if (input) commitCellValue(rowId, key, input.value)
      setEditingCell(null)

      if (rowId === 'new') {
        handleSaveNewRow()
      } else if (dirtyRows.has(rowId)) {
        handleSaveRow(rowId as number)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditingCell(null)
    }
  }

  // Save an existing row
  const handleSaveRow = async (rowId: number) => {
    const changes = dirtyRows.get(rowId)
    if (!changes || Object.keys(changes).length === 0) return

    setSavingRows(prev => new Set(prev).add(rowId))
    try {
      await onUpdate(rowId, changes)
      setDirtyRows(prev => {
        const next = new Map(prev)
        next.delete(rowId)
        return next
      })
    } catch (err: any) {
      const msg = err?.message || 'Lỗi khi lưu'
      setErrors(prev => new Map(prev).set(`${rowId}:save`, msg))
    } finally {
      setSavingRows(prev => {
        const next = new Set(prev)
        next.delete(rowId)
        return next
      })
    }
  }

  // Save new row
  const handleSaveNewRow = async () => {
    // Validate required fields
    const missing: string[] = []
    COLUMNS.filter(c => c.required).forEach(col => {
      const val = newRowData[col.key]
      if (!val || val === '') missing.push(col.label)
    })

    if (missing.length > 0) {
      missing.forEach(label => {
        const col = COLUMNS.find(c => c.label === label)
        if (col) setErrors(prev => new Map(prev).set(`new:${col.key}`, 'Bắt buộc'))
      })
      return
    }

    setSavingRows(prev => new Set(prev).add('new'))
    try {
      await onCreate(newRowData)
      setNewRowData({ ...EMPTY_NEW_ROW })
      setShowNewRow(false)
      setErrors(prev => {
        const next = new Map(prev)
        for (const key of next.keys()) {
          if (key.startsWith('new:')) next.delete(key)
        }
        return next
      })
    } catch (err: any) {
      const msg = err?.message || 'Lỗi khi tạo'
      setErrors(prev => new Map(prev).set('new:save', msg))
    } finally {
      setSavingRows(prev => {
        const next = new Set(prev)
        next.delete('new')
        return next
      })
    }
  }

  // Revert row changes
  const handleRevertRow = (rowId: number | 'new') => {
    if (rowId === 'new') {
      setNewRowData({ ...EMPTY_NEW_ROW })
      setShowNewRow(false)
    } else {
      setDirtyRows(prev => {
        const next = new Map(prev)
        next.delete(rowId)
        return next
      })
    }
    setEditingCell(null)
    // Clear errors for this row
    setErrors(prev => {
      const next = new Map(prev)
      for (const key of next.keys()) {
        if (key.startsWith(`${rowId}:`)) next.delete(key)
      }
      return next
    })
  }

  // Render a single cell
  const renderCell = (rowId: number | 'new', product: Product | Record<string, any>, col: Column, colIndex: number) => {
    const isEditing = editingCell?.rowId === rowId && editingCell?.colIndex === colIndex
    const value = getDisplayValue(rowId, product, col.key)
    const errorKey = `${rowId}:${col.key}`
    const hasError = errors.has(errorKey)
    const isSaving = savingRows.has(rowId)

    if (isEditing) {
      if (col.type === 'select' && col.options) {
        return (
          <td
            key={col.key}
            className={cn('spreadsheet-cell-editing', col.width)}
          >
            <select
              ref={inputRef as React.RefObject<HTMLSelectElement>}
              defaultValue={value}
              onChange={(e) => {
                commitCellValue(rowId, col.key, e.target.value)
                // Move to next cell after select
                const nextCol = colIndex + 1
                if (nextCol < COLUMNS.length) {
                  setEditingCell({ rowId, colIndex: nextCol })
                } else {
                  setEditingCell(null)
                }
              }}
              onKeyDown={(e) => handleKeyDown(e, rowId, colIndex)}
              onBlur={() => setEditingCell(null)}
              className="w-full h-full border-0 outline-none bg-transparent text-sm py-1"
            >
              {col.options.map(opt => (
                <option key={opt} value={opt}>{opt || '—'}</option>
              ))}
            </select>
          </td>
        )
      }

      return (
        <td
          key={col.key}
          className={cn('spreadsheet-cell-editing', col.width)}
        >
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={col.type === 'number' ? 'number' : 'text'}
            defaultValue={value}
            onKeyDown={(e) => handleKeyDown(e, rowId, colIndex)}
            onBlur={(e) => {
              commitCellValue(rowId, col.key, e.target.value)
              setEditingCell(null)
            }}
            className={cn(
              'w-full h-full border-0 outline-none bg-transparent text-sm py-1',
              col.mono && 'font-mono'
            )}
            step={col.type === 'number' ? 'any' : undefined}
          />
        </td>
      )
    }

    // Display mode
    const displayVal = col.type === 'number' ? formatNumber(value) : value
    return (
      <td
        key={col.key}
        className={cn(
          col.width,
          'cursor-pointer select-none truncate',
          hasError && 'bg-red-50',
          isSaving && 'opacity-50'
        )}
        onClick={() => !isSaving && startEditing(rowId, colIndex)}
        title={hasError ? errors.get(errorKey) : displayVal || undefined}
      >
        <span className={cn(
          'block truncate text-sm',
          col.mono && 'font-mono tracking-wide',
          col.key === 'partNumber' && value && 'text-amber-600',
          !value && 'text-stone-300'
        )}>
          {displayVal || '—'}
        </span>
        {hasError && (
          <span className="text-[10px] text-red-500">{errors.get(errorKey)}</span>
        )}
      </td>
    )
  }

  // Render action cell for a row
  const renderActions = (rowId: number | 'new') => {
    const isDirty = rowId === 'new' ? true : dirtyRows.has(rowId)
    const isSaving = savingRows.has(rowId)
    const saveError = errors.get(`${rowId}:save`)

    return (
      <td className="w-[90px] min-w-[90px] sticky right-0 bg-white border-l border-stone-200">
        <div className="flex items-center gap-1 justify-center">
          {isDirty && !isSaving && (
            <>
              <button
                onClick={() => rowId === 'new' ? handleSaveNewRow() : handleSaveRow(rowId as number)}
                className="p-1 rounded hover:bg-amber-50 text-amber-600 hover:text-amber-700 transition-colors"
                title="Lưu (Enter)"
              >
                <Save className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => handleRevertRow(rowId)}
                className="p-1 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
                title="Hoàn tác (Esc)"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {isSaving && (
            <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin" />
          )}
          {saveError && (
            <span className="text-[10px] text-red-500 truncate max-w-[80px]" title={saveError}>Lỗi</span>
          )}
        </div>
      </td>
    )
  }

  if (isLoading) {
    return (
      <div className="spreadsheet-wrapper">
        <table className="spreadsheet-table">
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th key={col.key} className={col.width}>{col.label}</th>
              ))}
              <th className="w-[90px] min-w-[90px]" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, i) => (
              <tr key={i}>
                <td colSpan={COLUMNS.length + 1}>
                  <div className="h-8 skeleton" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-400">
          Click vào ô để chỉnh sửa. Tab để di chuyển. Enter để lưu dòng.
        </p>
        {!showNewRow && (
          <button
            onClick={() => setShowNewRow(true)}
            className="btn btn-secondary px-3 py-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm dòng
          </button>
        )}
      </div>

      {/* Spreadsheet */}
      <div className="spreadsheet-wrapper">
        <table className="spreadsheet-table">
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th key={col.key} className={col.width}>
                  {col.label}
                  {col.required && <span className="text-red-400 ml-0.5">*</span>}
                </th>
              ))}
              <th className="w-[90px] min-w-[90px] sticky right-0 bg-stone-50 border-l border-stone-200" />
            </tr>
          </thead>
          <tbody>
            {/* New row at top */}
            {showNewRow && (
              <tr className="spreadsheet-new-row">
                {COLUMNS.map((col, colIndex) =>
                  renderCell('new', newRowData, col, colIndex)
                )}
                {renderActions('new')}
              </tr>
            )}

            {/* Product rows */}
            {products.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="py-12 text-center">
                  <p className="text-stone-400 text-sm">Không có sản phẩm nào</p>
                </td>
              </tr>
            ) : (
              products.map((product) => {
                const isDirty = dirtyRows.has(product.id)
                return (
                  <tr
                    key={product.id}
                    className={cn(
                      isDirty && 'spreadsheet-row-dirty',
                      savingRows.has(product.id) && 'spreadsheet-row-saving'
                    )}
                  >
                    {COLUMNS.map((col, colIndex) =>
                      renderCell(product.id, product, col, colIndex)
                    )}
                    {renderActions(product.id)}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Dirty rows summary */}
      {dirtyRows.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm">
          <span className="text-amber-700 font-medium">
            {dirtyRows.size} dòng chưa lưu
          </span>
          <button
            onClick={() => {
              dirtyRows.forEach((_, rowId) => {
                if (typeof rowId === 'number') handleSaveRow(rowId)
              })
            }}
            className="text-amber-600 hover:text-amber-800 font-medium underline underline-offset-2"
          >
            Lưu tất cả
          </button>
        </div>
      )}
    </div>
  )
}
