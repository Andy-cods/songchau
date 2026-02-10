import { useState, useEffect } from 'react'
import { Plus, Search, X, ChevronLeft, ChevronRight, Eye, Edit, Copy, Trash2, FileText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { fetchQuotations, deleteQuotation, fetchQuotation, createQuotation, getNextQuoteNumber, type Quotation } from '@/lib/api'
import { cn } from '@/lib/utils'
import { QUOTATION_STATUS_COLORS, QUOTATION_STATUS_LABELS, QUOTATION_STATUSES } from '@/lib/constants'
import { format } from 'date-fns'
import { useToast } from '@/hooks/use-toast'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import QuotationDetail from '@/components/quotations/QuotationDetail'

export default function Quotations() {
  const navigate = useNavigate()
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)

  const { toast } = useToast()

  // Detail panel
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: number; quoteNumber: string }>({ open: false, id: 0, quoteNumber: '' })

  // Filters
  const [search, setSearch] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')

  // Pagination
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const limit = 20

  useEffect(() => {
    loadQuotations()
  }, [page, search, selectedStatus])

  const loadQuotations = async () => {
    setLoading(true)
    try {
      const response = await fetchQuotations({
        search,
        status: selectedStatus,
        page,
        limit,
      })
      setQuotations(response.data)
      setTotal(response.pagination.total)
      setTotalPages(response.pagination.totalPages)
    } catch (error) {
      console.error('Failed to load quotations:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleClearFilters = () => {
    setSearch('')
    setSelectedStatus('')
    setPage(1)
  }

  const handleDelete = (id: number, quoteNumber: string) => {
    setConfirmDelete({ open: true, id, quoteNumber })
  }

  const handleConfirmDelete = async () => {
    try {
      await deleteQuotation(confirmDelete.id)
      loadQuotations()
      toast({ title: 'Xóa báo giá thành công' })
    } catch (error) {
      console.error('Failed to delete quotation:', error)
      toast({ title: 'Xóa báo giá thất bại', variant: 'destructive' })
    } finally {
      setConfirmDelete({ open: false, id: 0, quoteNumber: '' })
    }
  }

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '—'
    return new Intl.NumberFormat('vi-VN').format(amount) + ' VND'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-50">
            Quotation Management
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            {loading ? 'Loading...' : `${total} quotations total`}
          </p>
        </div>
        <button
          onClick={() => navigate('/quotations/new')}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
        >
          <Plus className="h-4 w-4" />
          Tạo báo giá mới
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-4">
        <div className="grid grid-cols-3 gap-3">
          {/* Search */}
          <div className="col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search quote number, notes..."
                className="w-full rounded-lg bg-slate-900/50 border border-slate-700/50 pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>

          {/* Status */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">All Status</option>
            {QUOTATION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Clear Filters */}
        {(search || selectedStatus) && (
          <button
            onClick={handleClearFilters}
            className="mt-3 flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="h-4 w-4" />
            Clear all filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800/30 border-b-2 border-slate-700/50">
              <tr>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Quote Number
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Created Date
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Total Amount
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Loading quotations...
                  </td>
                </tr>
              ) : quotations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <FileText className="h-8 w-8 text-slate-500" />
                      </div>
                      <div>
                        <p className="empty-state-title">No quotations found</p>
                        <p className="empty-state-description mt-1">Try adjusting your search or filters</p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                quotations.map((quotation, idx) => (
                  <tr
                    key={quotation.id}
                    className={cn(
                      'transition-colors',
                      idx % 2 === 0 ? 'bg-slate-900/20' : 'bg-transparent',
                      'hover:bg-slate-700/30'
                    )}
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-mono font-medium text-blue-400">
                        {quotation.quoteNumber}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-slate-200">{quotation.customerName || '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {format(new Date(quotation.createdAt), 'dd/MM/yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-slate-200">
                        {formatCurrency(quotation.totalAmount)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-block px-2 py-1 rounded border text-xs font-medium',
                          QUOTATION_STATUS_COLORS[quotation.status] ||
                            'bg-slate-700/50 text-slate-300 border-slate-600'
                        )}
                      >
                        {QUOTATION_STATUS_LABELS[quotation.status] || quotation.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedId(quotation.id)
                            setDetailOpen(true)
                          }}
                          className="p-1 rounded text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                          title="View"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => navigate(`/quotations/${quotation.id}/edit`)}
                          className="p-1 rounded text-slate-400 hover:text-green-400 hover:bg-green-500/10 transition-colors"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            try {
                              const { data: original } = await fetchQuotation(quotation.id)
                              const { quoteNumber } = await getNextQuoteNumber()
                              await createQuotation({
                                quoteNumber,
                                customerId: original.customerId,
                                status: 'draft',
                                subtotal: original.subtotal,
                                taxRate: original.taxRate,
                                taxAmount: original.taxAmount,
                                totalAmount: original.totalAmount,
                                currency: original.currency,
                                validUntil: original.validUntil,
                                notes: original.notes,
                                internalNotes: original.internalNotes,
                                items: (original.items || []).map((item) => ({
                                  productId: item.productId,
                                  quantity: item.quantity,
                                  unitPrice: item.unitPrice,
                                  costPrice: item.costPrice ?? null,
                                  amount: item.amount,
                                  notes: item.notes || null,
                                })),
                              })
                              loadQuotations()
                            } catch (error) {
                              console.error('Failed to duplicate:', error)
                              toast({ title: 'Nhân bản báo giá thất bại', variant: 'destructive' })
                            }
                          }}
                          className="p-1 rounded text-slate-400 hover:text-purple-400 hover:bg-purple-500/10 transition-colors"
                          title="Duplicate"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(quotation.id, quotation.quoteNumber)}
                          className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-700 bg-slate-900/50 px-4 py-3">
            <p className="text-sm text-slate-400">
              Page {page} of {totalPages} ({total} total)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Slide-over */}
      <QuotationDetail
        quotationId={selectedId}
        isOpen={detailOpen}
        onClose={() => {
          setDetailOpen(false)
          setSelectedId(null)
          loadQuotations()
        }}
      />

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title={`Xóa báo giá ${confirmDelete.quoteNumber}?`}
        description="Hành động này không thể hoàn tác."
        confirmLabel="Xóa"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete({ open: false, id: 0, quoteNumber: '' })}
      />
    </div>
  )
}
