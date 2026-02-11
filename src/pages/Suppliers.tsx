import { useState } from 'react'
import { Plus, Search, X, ChevronLeft, ChevronRight, Star } from 'lucide-react'
import { type Supplier } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SUPPLIER_COUNTRIES, SUPPLIER_PLATFORMS } from '@/lib/constants'
import { useSuppliers, useDeleteSupplier } from '@/hooks/useSuppliers'
import { useDebounce } from '@/hooks/useDebounce'
import { useToast } from '@/hooks/use-toast'
import SupplierForm from '@/components/suppliers/SupplierForm'
import SupplierDetail from '@/components/suppliers/SupplierDetail'

export default function Suppliers() {
  // Filters
  const [searchInput, setSearchInput] = useState('')
  const [selectedCountry, setSelectedCountry] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [minRating, setMinRating] = useState('')
  const [page, setPage] = useState(1)

  // UI State
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')

  const search = useDebounce(searchInput, 300)
  const { toast } = useToast()

  // React Query
  const deleteSupplierMutation = useDeleteSupplier()
  const { data: suppliersData, isLoading: loading } = useSuppliers({
    search,
    country: selectedCountry || undefined,
    platform: selectedPlatform || undefined,
    minRating: minRating ? parseInt(minRating) : undefined,
    page,
    limit: 20,
  })

  const suppliers = suppliersData?.data || []
  const total = suppliersData?.pagination?.total || 0
  const totalPages = suppliersData?.pagination?.totalPages || 0

  const handleClearFilters = () => {
    setSearchInput('')
    setSelectedCountry('')
    setSelectedPlatform('')
    setMinRating('')
    setPage(1)
  }

  const handleRowClick = (supplier: Supplier) => {
    setSelectedSupplier(supplier)
    setIsDetailOpen(true)
  }

  const handleAddSupplier = () => {
    setFormMode('create')
    setSelectedSupplier(null)
    setIsFormOpen(true)
  }

  const handleEditSupplier = (supplier: Supplier) => {
    setFormMode('edit')
    setSelectedSupplier(supplier)
    setIsDetailOpen(false)
    setIsFormOpen(true)
  }

  const handleDeleteSupplier = async (supplier: Supplier) => {
    try {
      await deleteSupplierMutation.mutateAsync(supplier.id)
      setIsDetailOpen(false)
      setSelectedSupplier(null)
      toast({ title: `Đã xóa ${supplier.companyName}` })
    } catch (error) {
      console.error('Failed to delete supplier:', error)
      toast({ title: 'Xóa nhà cung cấp thất bại', variant: 'destructive' })
    }
  }

  const renderStars = (rating: number | null) => {
    if (!rating) return <span className="text-stone-500 text-sm">—</span>

    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              'h-4 w-4',
              star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-stone-600'
            )}
          />
        ))}
        <span className="ml-1 text-xs text-stone-400">({rating})</span>
      </div>
    )
  }

  const renderScoreBar = (score: number | null, maxScore: number = 10) => {
    if (!score) return <span className="text-stone-500 text-sm">—</span>

    const percentage = (score / maxScore) * 100

    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-stone-200 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              score >= 8
                ? 'bg-green-500'
                : score >= 6
                ? 'bg-yellow-500'
                : 'bg-red-500'
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className="text-xs text-stone-400 w-8">{score}/10</span>
      </div>
    )
  }

  const getCountryFlag = (country: string) => {
    const countryData = SUPPLIER_COUNTRIES.find((c) => c.value === country)
    return countryData?.flag || '🌐'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-stone-900">
            Nhà cung cấp
          </h2>
          <p className="text-sm text-stone-400 mt-1">
            {loading ? 'Đang tải...' : `${total} nhà cung cấp`}
          </p>
        </div>
        <button
          onClick={handleAddSupplier}
          className="btn btn-primary px-4 py-2.5 text-sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          Thêm nhà cung cấp
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="grid grid-cols-4 gap-3">
          {/* Search */}
          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-500" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm công ty, liên hệ..."
                className="w-full rounded-lg bg-stone-50 border border-stone-200 pl-9 pr-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>

          {/* Country */}
          <select
            value={selectedCountry}
            onChange={(e) => setSelectedCountry(e.target.value)}
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">Tất cả quốc gia</option>
            {SUPPLIER_COUNTRIES.map((country) => (
              <option key={country.value} value={country.value}>
                {country.label}
              </option>
            ))}
          </select>

          {/* Platform */}
          <select
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value)}
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">Tất cả platform</option>
            {SUPPLIER_PLATFORMS.map((platform) => (
              <option key={platform.value} value={platform.value}>
                {platform.label}
              </option>
            ))}
          </select>

          {/* Min Rating */}
          <select
            value={minRating}
            onChange={(e) => setMinRating(e.target.value)}
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">Tất cả rating</option>
            <option value="4">4+ sao</option>
            <option value="3">3+ sao</option>
          </select>
        </div>

        {/* Clear Filters */}
        {(searchInput || selectedCountry || selectedPlatform || minRating) && (
          <button
            onClick={handleClearFilters}
            className="mt-3 flex items-center gap-2 text-sm text-stone-400 hover:text-stone-700 transition-colors"
          >
            <X className="h-4 w-4" />
            Xóa bộ lọc
          </button>
        )}
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Công ty</th>
              <th>Quốc gia</th>
              <th>Platform</th>
              <th>Rating</th>
              <th>Quality</th>
              <th>Delivery</th>
              <th>Price</th>
              <th>Liên hệ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, idx) => (
                <tr key={idx}>
                  <td colSpan={8}>
                    <div className="h-10 bg-stone-50 animate-pulse rounded" />
                  </td>
                </tr>
              ))
            ) : suppliers.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="rounded-full bg-stone-50 p-4">
                      <Search className="h-8 w-8 text-stone-500" />
                    </div>
                    <div>
                      <p className="font-medium text-stone-600">Không tìm thấy nhà cung cấp</p>
                      <p className="text-sm text-stone-500 mt-1">Thử thay đổi bộ lọc</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              suppliers.map((supplier: Supplier, idx: number) => (
                <tr
                  key={supplier.id}
                  onClick={() => handleRowClick(supplier)}
                  className={cn(
                    'cursor-pointer transition-colors duration-150',
                    idx % 2 === 0 && 'even:bg-stone-50'
                  )}
                >
                  <td>
                    <div>
                      <p className="text-sm font-medium text-stone-700">
                        {supplier.companyName}
                      </p>
                      {supplier.companyNameLocal && (
                        <p className="text-xs text-stone-400">
                          {supplier.companyNameLocal}
                        </p>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="text-xl">{getCountryFlag(supplier.country)}</span>
                    <span className="ml-2 text-sm text-stone-600 capitalize">
                      {supplier.country}
                    </span>
                  </td>
                  <td>
                    {supplier.platform ? (
                      <span className="badge border bg-amber-500/10 text-amber-400 border-amber-500/20">
                        {supplier.platform}
                      </span>
                    ) : (
                      <span className="text-sm text-stone-500">—</span>
                    )}
                  </td>
                  <td>{renderStars(supplier.rating)}</td>
                  <td className="min-w-[120px]">
                    {renderScoreBar(supplier.qualityScore)}
                  </td>
                  <td className="min-w-[120px]">
                    {renderScoreBar(supplier.deliveryScore)}
                  </td>
                  <td className="min-w-[120px]">
                    {renderScoreBar(supplier.priceScore)}
                  </td>
                  <td>
                    <div>
                      <p className="text-sm text-stone-700">
                        {supplier.contactName || '—'}
                      </p>
                      {supplier.contactPhone && (
                        <p className="text-xs text-stone-400">{supplier.contactPhone}</p>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-stone-200 bg-stone-50 px-4 py-3">
            <p className="text-sm text-stone-400">
              Trang {page} / {totalPages} ({total} NCC)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Trước
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Supplier Detail Slide-over */}
      <SupplierDetail
        supplier={selectedSupplier}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onEdit={handleEditSupplier}
        onDelete={handleDeleteSupplier}
      />

      {/* Supplier Form Modal */}
      <SupplierForm
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        supplier={formMode === 'edit' ? selectedSupplier : null}
        mode={formMode}
      />
    </div>
  )
}
