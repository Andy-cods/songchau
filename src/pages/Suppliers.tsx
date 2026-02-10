import { useState, useEffect } from 'react'
import { Plus, Search, X, ChevronLeft, ChevronRight, Star } from 'lucide-react'
import { fetchSuppliers, type Supplier } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SUPPLIER_COUNTRIES, SUPPLIER_PLATFORMS } from '@/lib/constants'

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [selectedCountry, setSelectedCountry] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [minRating, setMinRating] = useState('')

  // Pagination
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const limit = 20

  // Load suppliers when filters change
  useEffect(() => {
    loadSuppliers()
  }, [page, search, selectedCountry, selectedPlatform, minRating])

  const loadSuppliers = async () => {
    setLoading(true)
    try {
      const response = await fetchSuppliers({
        search,
        country: selectedCountry,
        platform: selectedPlatform,
        minRating: minRating ? parseInt(minRating) : undefined,
        page,
        limit,
      })
      setSuppliers(response.data)
      setTotal(response.pagination.total)
      setTotalPages(response.pagination.totalPages)
    } catch (error) {
      console.error('Failed to load suppliers:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleClearFilters = () => {
    setSearch('')
    setSelectedCountry('')
    setSelectedPlatform('')
    setMinRating('')
    setPage(1)
  }

  const renderStars = (rating: number | null) => {
    if (!rating) return <span className="text-slate-500 text-sm">—</span>

    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              'h-4 w-4',
              star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-slate-600'
            )}
          />
        ))}
        <span className="ml-1 text-xs text-slate-400">({rating})</span>
      </div>
    )
  }

  const renderScoreBar = (score: number | null, maxScore: number = 10) => {
    if (!score) return <span className="text-slate-500 text-sm">—</span>

    const percentage = (score / maxScore) * 100

    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
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
        <span className="text-xs text-slate-400 w-8">{score}/10</span>
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
          <h2 className="font-display text-2xl font-bold text-slate-50">
            Supplier Management
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            {loading ? 'Loading...' : `${total} suppliers total`}
          </p>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
        >
          <Plus className="h-4 w-4" />
          Thêm nhà cung cấp
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-4">
        <div className="grid grid-cols-4 gap-3">
          {/* Search */}
          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, contact..."
                className="w-full rounded-lg bg-slate-900 border border-slate-700 pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Country */}
          <select
            value={selectedCountry}
            onChange={(e) => setSelectedCountry(e.target.value)}
            className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Countries</option>
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
            className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Platforms</option>
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
            className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Ratings</option>
            <option value="4">4+ Stars</option>
            <option value="3">3+ Stars</option>
          </select>
        </div>

        {/* Clear Filters */}
        {(search || selectedCountry || selectedPlatform || minRating) && (
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
            <thead className="bg-slate-900/50 border-b border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Company Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Country
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Platform
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Rating
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Quality
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Delivery
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Price
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Contact
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Loading suppliers...
                  </td>
                </tr>
              ) : suppliers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No suppliers found
                  </td>
                </tr>
              ) : (
                suppliers.map((supplier, idx) => (
                  <tr
                    key={supplier.id}
                    className={cn(
                      'cursor-pointer transition-colors',
                      idx % 2 === 0 ? 'bg-slate-900/20' : 'bg-transparent',
                      'hover:bg-slate-700/30'
                    )}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-200">
                          {supplier.companyName}
                        </p>
                        {supplier.companyNameLocal && (
                          <p className="text-xs text-slate-400">
                            {supplier.companyNameLocal}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xl">{getCountryFlag(supplier.country)}</span>
                      <span className="ml-2 text-sm text-slate-300 capitalize">
                        {supplier.country}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {supplier.platform ? (
                        <span className="inline-block px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/20 text-xs font-medium text-indigo-400">
                          {supplier.platform}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{renderStars(supplier.rating)}</td>
                    <td className="px-4 py-3 min-w-[120px]">
                      {renderScoreBar(supplier.qualityScore)}
                    </td>
                    <td className="px-4 py-3 min-w-[120px]">
                      {renderScoreBar(supplier.deliveryScore)}
                    </td>
                    <td className="px-4 py-3 min-w-[120px]">
                      {renderScoreBar(supplier.priceScore)}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm text-slate-200">
                          {supplier.contactName || '—'}
                        </p>
                        {supplier.contactPhone && (
                          <p className="text-xs text-slate-400">{supplier.contactPhone}</p>
                        )}
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
    </div>
  )
}
