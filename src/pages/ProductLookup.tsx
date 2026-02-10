import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { useProducts, useProductStats } from '@/hooks/useProducts'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'
import { type Product } from '@/lib/api'

const QUICK_BRANDS = ['Panasonic', 'Fuji', 'Samsung', 'JUKI', 'Yamaha', 'Hitachi', 'Casio', 'ASM/Siemens']
const MATERIALS = ['CERAMIC', 'METAL', 'RUBBER', 'O-RING']

export default function ProductLookup() {
  const [searchInput, setSearchInput] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedMaterial, setSelectedMaterial] = useState('')

  const search = useDebounce(searchInput, 200)

  const { data: productsData, isLoading } = useProducts({
    search,
    brand: selectedBrand || undefined,
    material: selectedMaterial || undefined,
    limit: 100,
  })

  const { data: statsData } = useProductStats()

  const products = productsData?.data || []
  const count = productsData?.pagination.total || 0
  const stats = statsData || { totalProducts: 0, totalBrands: 0 }

  const hasFilters = search || selectedBrand || selectedMaterial

  const handleBrandClick = (brand: string) => {
    setSelectedBrand(selectedBrand === brand ? '' : brand)
  }

  const handleMaterialClick = (material: string) => {
    setSelectedMaterial(selectedMaterial === material ? '' : material)
  }

  const handleClearAll = () => {
    setSearchInput('')
    setSelectedBrand('')
    setSelectedMaterial('')
  }

  const materialColors: Record<string, string> = {
    CERAMIC: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    METAL: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
    RUBBER: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    'O-RING': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  }

  const brandColors: Record<string, string> = {
    Panasonic: 'border-blue-500/50 hover:bg-blue-500/10',
    Fuji: 'border-purple-500/50 hover:bg-purple-500/10',
    Samsung: 'border-green-500/50 hover:bg-green-500/10',
    JUKI: 'border-orange-500/50 hover:bg-orange-500/10',
    Yamaha: 'border-pink-500/50 hover:bg-pink-500/10',
    Hitachi: 'border-indigo-500/50 hover:bg-indigo-500/10',
    Casio: 'border-yellow-500/50 hover:bg-yellow-500/10',
    'ASM/Siemens': 'border-red-500/50 hover:bg-red-500/10',
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header Section */}
      <div className="text-center pt-12 pb-8">
        <h1 className="font-display text-2xl font-bold text-white">Song Châu</h1>
        <p className="text-slate-400 mt-1">Tra cứu nhanh linh kiện SMT</p>

        {/* Stats */}
        {!hasFilters && (
          <div className="flex items-center justify-center gap-6 mt-4 text-sm">
            <div className="text-slate-400">
              <span className="font-semibold text-brand-400">{stats.totalProducts}</span> sản phẩm
            </div>
            <div className="w-px h-4 bg-slate-700" />
            <div className="text-slate-400">
              <span className="font-semibold text-brand-400">{stats.totalBrands}</span> thương hiệu
            </div>
            <div className="w-px h-4 bg-slate-700" />
            <div className="text-slate-400">
              <span className="font-semibold text-brand-400">20+</span> dòng máy
            </div>
          </div>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-slate-500" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Nhập mã part number, tên sản phẩm, hoặc kích thước..."
          className="w-full h-14 rounded-xl bg-slate-800 border border-slate-700 pl-12 pr-12 text-lg text-white placeholder:text-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none transition-all"
          autoFocus
        />
        {searchInput && (
          <button
            onClick={() => setSearchInput('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Quick Filter Chips - Brands */}
      <div className="mb-4">
        <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Thương hiệu</h3>
        <div className="flex gap-2 flex-wrap">
          {QUICK_BRANDS.map((brand) => {
            const isActive = selectedBrand === brand
            return (
              <button
                key={brand}
                onClick={() => handleBrandClick(brand)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm border transition-all duration-200',
                  isActive
                    ? 'bg-brand-500/10 border-brand-500/50 text-brand-400'
                    : cn('border-slate-700 text-slate-400', brandColors[brand])
                )}
              >
                {brand}
              </button>
            )
          })}
        </div>
      </div>

      {/* Material Chips */}
      <div className="mb-6">
        <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Vật liệu</h3>
        <div className="flex gap-2 flex-wrap">
          {MATERIALS.map((material) => {
            const isActive = selectedMaterial === material
            return (
              <button
                key={material}
                onClick={() => handleMaterialClick(material)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm border transition-all duration-200',
                  isActive
                    ? materialColors[material]
                    : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                )}
              >
                {material}
              </button>
            )
          })}

          {/* Clear All Button */}
          {hasFilters && (
            <button
              onClick={handleClearAll}
              className="px-3 py-1.5 rounded-full text-sm border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all duration-200"
            >
              <X className="h-3 w-3 inline mr-1" />
              Xóa tất cả
            </button>
          )}
        </div>
      </div>

      {/* Results Count */}
      {hasFilters && (
        <div className="mb-4">
          <p className="text-sm text-slate-400">
            Tìm thấy <span className="font-semibold text-brand-400">{count}</span> sản phẩm
          </p>
        </div>
      )}

      {/* Results Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-40 bg-slate-800/50 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : products.length === 0 ? (
        // Empty State
        <div className="text-center py-16">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-slate-800/50 border border-slate-700 mb-4">
            <Search className="h-10 w-10 text-slate-500" />
          </div>
          <h3 className="font-display text-xl font-semibold text-slate-300 mb-2">
            Không tìm thấy sản phẩm
          </h3>
          <p className="text-slate-500 mb-4">
            {hasFilters ? 'Thử điều chỉnh từ khóa tìm kiếm hoặc bộ lọc' : 'Bắt đầu tìm kiếm bằng cách nhập mã hoặc chọn thương hiệu'}
          </p>
          {hasFilters && (
            <button onClick={handleClearAll} className="btn btn-secondary px-4 py-2 text-sm">
              Xóa bộ lọc
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product: Product) => (
            <div
              key={product.id}
              className={cn(
                'group bg-slate-800/50 border-2 rounded-xl p-5 transition-all duration-200 cursor-pointer',
                'hover:bg-slate-800 hover:border-brand-500/30 hover:shadow-lg hover:shadow-brand-500/5',
                brandColors[product.brand || ''] ? `border-slate-700 ${brandColors[product.brand || '']}` : 'border-slate-700'
              )}
            >
              {/* Part Number */}
              <div className="mb-3">
                <p className="part-number text-lg">{product.partNumber}</p>
              </div>

              {/* Name & Size */}
              <div className="mb-3">
                <p className="text-white font-medium">{product.name}</p>
                {product.size && (
                  <p className="font-mono text-sm text-slate-400 mt-1">{product.size}</p>
                )}
              </div>

              {/* Brand & Model & Material */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {product.brand && (
                  <span className="badge border bg-slate-900/50 border-slate-700 text-xs font-medium text-slate-300">
                    {product.brand}
                  </span>
                )}
                {product.machineModel && (
                  <span className="badge border bg-slate-900/50 border-slate-700 text-xs text-slate-400">
                    {product.machineModel}
                  </span>
                )}
                {product.material && (
                  <span className={cn('badge border text-xs font-medium', materialColors[product.material] || 'bg-slate-700/50 text-slate-300 border-slate-600')}>
                    {product.material}
                  </span>
                )}
              </div>

              {/* Remark */}
              {product.remark && (
                <div className="pt-3 border-t border-slate-700">
                  <p className="text-xs text-slate-500 mb-1">Compatible:</p>
                  <p className="text-xs text-slate-400">{product.remark}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
