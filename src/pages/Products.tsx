import { useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { useProducts, useProductBrands, useProductModels } from '@/hooks/useProducts'
import { useQuery } from '@tanstack/react-query'
import { fetchCategories, type Product } from '@/lib/api'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'

const MATERIALS = ['CERAMIC', 'METAL', 'RUBBER', 'O-RING']

export default function Products() {
  // Filter states
  const [searchInput, setSearchInput] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedMaterial, setSelectedMaterial] = useState('')
  const [page, setPage] = useState(1)

  // Debounce search
  const search = useDebounce(searchInput, 300)

  // Queries
  const { data: productsData, isLoading } = useProducts({
    search,
    category: selectedCategory || undefined,
    brand: selectedBrand || undefined,
    machineModel: selectedModel || undefined,
    material: selectedMaterial || undefined,
    page,
    limit: 20,
  })

  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  })

  const { data: brandsData } = useProductBrands()
  const { data: modelsData } = useProductModels(selectedBrand || null)

  const products = productsData?.data || []
  const pagination = productsData?.pagination || { total: 0, totalPages: 0, page: 1 }
  const categories = categoriesData?.data || []
  const brands = brandsData?.data || []
  const models = modelsData?.data || []

  const activeFiltersCount = [search, selectedCategory, selectedBrand, selectedModel, selectedMaterial].filter(Boolean).length

  const handleClearFilters = () => {
    setSearchInput('')
    setSelectedCategory('')
    setSelectedBrand('')
    setSelectedModel('')
    setSelectedMaterial('')
    setPage(1)
  }

  const handleBrandChange = (brand: string) => {
    setSelectedBrand(brand)
    setSelectedModel('') // Reset model when brand changes
  }

  const materialColors: Record<string, string> = {
    CERAMIC: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    METAL: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
    RUBBER: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    'O-RING': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  }

  const brandColors: Record<string, string> = {
    Panasonic: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    Fuji: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    Samsung: 'bg-green-500/10 text-green-400 border-green-500/30',
    JUKI: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
    Yamaha: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
    Hitachi: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
    Casio: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    'ASM/Siemens': 'bg-red-500/10 text-red-400 border-red-500/30',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-50">Sản phẩm</h2>
          <p className="text-sm text-slate-400 mt-1">
            {isLoading ? 'Đang tải...' : `${pagination.total} sản phẩm trong catalog`}
          </p>
        </div>
        <button className="btn btn-primary px-4 py-2.5 text-sm">
          <Plus className="h-4 w-4 mr-2" />
          Thêm sản phẩm
        </button>
      </div>

      {/* Filter Bar */}
      <div className="card p-4">
        <div className="flex gap-3 flex-wrap items-center">
          {/* Search */}
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm theo mã, tên..."
              className="w-full rounded-lg bg-slate-900/50 border border-slate-700/50 pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          {/* Category */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">Tất cả loại</option>
            {categories.map((cat) => (
              <option key={cat.slug} value={cat.slug}>
                {cat.name}
              </option>
            ))}
          </select>

          {/* Brand */}
          <select
            value={selectedBrand}
            onChange={(e) => handleBrandChange(e.target.value)}
            className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">Tất cả thương hiệu</option>
            {brands.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </select>

          {/* Model */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={!selectedBrand}
            className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">Tất cả model</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>

          {/* Material */}
          <select
            value={selectedMaterial}
            onChange={(e) => setSelectedMaterial(e.target.value)}
            className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">Tất cả vật liệu</option>
            {MATERIALS.map((material) => (
              <option key={material} value={material}>
                {material}
              </option>
            ))}
          </select>

          {/* Clear Button */}
          {activeFiltersCount > 0 && (
            <button
              onClick={handleClearFilters}
              className="flex items-center gap-1 px-3 py-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
              Xóa ({activeFiltersCount})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Part Number</th>
              <th>Tên SP</th>
              <th>Thương hiệu</th>
              <th>Model máy</th>
              <th>Vật liệu</th>
              <th>Kích thước</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              // Loading skeleton
              Array.from({ length: 8 }).map((_, idx) => (
                <tr key={idx}>
                  <td colSpan={7}>
                    <div className="h-10 bg-slate-800/50 animate-pulse rounded" />
                  </td>
                </tr>
              ))
            ) : products.length === 0 ? (
              // Empty state
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="rounded-full bg-slate-800/50 p-4">
                      <Search className="h-8 w-8 text-slate-500" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-300">Không tìm thấy sản phẩm</p>
                      <p className="text-sm text-slate-500 mt-1">Thử thay đổi bộ lọc</p>
                    </div>
                    {activeFiltersCount > 0 && (
                      <button
                        onClick={handleClearFilters}
                        className="btn btn-secondary px-3 py-1.5 text-xs"
                      >
                        Xóa bộ lọc
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              products.map((product: Product, idx: number) => (
                <tr
                  key={product.id}
                  className={cn(
                    'cursor-pointer transition-colors duration-150',
                    idx % 2 === 0 && 'even:bg-slate-800/10'
                  )}
                >
                  <td>
                    <span className="part-number">{product.partNumber}</span>
                  </td>
                  <td className="text-sm text-slate-200">{product.name}</td>
                  <td>
                    {product.brand ? (
                      <span
                        className={cn(
                          'badge border',
                          brandColors[product.brand] || 'bg-slate-700/50 text-slate-300 border-slate-600'
                        )}
                      >
                        {product.brand}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="text-sm text-slate-400">{product.machineModel || '—'}</td>
                  <td>
                    {product.material ? (
                      <span
                        className={cn(
                          'badge border',
                          materialColors[product.material] || 'bg-slate-700/50 text-slate-300 border-slate-600'
                        )}
                      >
                        {product.material}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="font-mono text-sm">{product.size || '—'}</td>
                  <td className="text-xs text-slate-500 truncate max-w-[200px]">{product.remark || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {!isLoading && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-700 bg-slate-900/50 px-4 py-3">
            <p className="text-sm text-slate-400">
              Hiển thị {(page - 1) * 20 + 1}-{Math.min(page * 20, pagination.total)} / {pagination.total} sản phẩm
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Trước
              </button>
              <span className="text-sm text-slate-400">
                Trang {page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
