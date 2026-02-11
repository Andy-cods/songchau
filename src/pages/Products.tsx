import { useState } from 'react'
import { Plus, Search, X, LayoutGrid, List } from 'lucide-react'
import { useProducts, useProductBrands, useProductModels, useCreateProduct, useUpdateProduct } from '@/hooks/useProducts'
import { useQuery } from '@tanstack/react-query'
import { fetchCategories, type Product } from '@/lib/api'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'
import { MATERIAL_COLORS, BRAND_COLORS } from '@/lib/constants'
import ProductForm from '@/components/products/ProductForm'
import ProductDetail from '@/components/products/ProductDetail'
import ProductCard from '@/components/products/ProductCard'

const MATERIALS = ['CERAMIC', 'METAL', 'RUBBER', 'O-RING']

export default function Products() {
  // Filter states
  const [searchInput, setSearchInput] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedMaterial, setSelectedMaterial] = useState('')
  const [page, setPage] = useState(1)

  // UI State
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('grid')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')

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

  const createMutation = useCreateProduct()
  const updateMutation = useUpdateProduct()

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

  const handleRowClick = (product: Product) => {
    setSelectedProduct(product)
    setIsDetailOpen(true)
  }

  const handleAddProduct = () => {
    setFormMode('create')
    setSelectedProduct(null)
    setIsFormOpen(true)
  }

  const handleEditProduct = (product: Product) => {
    setFormMode('edit')
    setSelectedProduct(product)
    setIsDetailOpen(false)
    setIsFormOpen(true)
  }

  const handleFormSubmit = async (data: Partial<Product>) => {
    if (formMode === 'create') {
      await createMutation.mutateAsync(data)
    } else if (selectedProduct) {
      await updateMutation.mutateAsync({ id: selectedProduct.id, data })
    }
  }

  const materialColors = MATERIAL_COLORS
  const brandColors = BRAND_COLORS

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-stone-900">Sản phẩm</h2>
          <p className="text-sm text-stone-400 mt-1">
            {isLoading ? 'Đang tải...' : `${pagination.total} sản phẩm trong catalog`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View Toggle */}
          <div className="flex items-center rounded-lg bg-white border border-stone-200 p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'flex items-center justify-center rounded-md p-2 transition-all',
                viewMode === 'grid'
                  ? 'bg-brand-500/20 text-brand-400 shadow-sm'
                  : 'text-stone-400 hover:text-stone-700'
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={cn(
                'flex items-center justify-center rounded-md p-2 transition-all',
                viewMode === 'table'
                  ? 'bg-brand-500/20 text-brand-400 shadow-sm'
                  : 'text-stone-400 hover:text-stone-700'
              )}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <button onClick={handleAddProduct} className="btn btn-primary px-4 py-2.5 text-sm">
            <Plus className="h-4 w-4 mr-2" />
            Thêm sản phẩm
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card p-4">
        <div className="flex gap-3 flex-wrap items-center">
          {/* Search */}
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-500" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm theo mã, tên..."
              className="w-full rounded-lg bg-stone-50 border border-stone-200 pl-9 pr-3 py-2 text-sm text-stone-700 placeholder:text-stone-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          {/* Category */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
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
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
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
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
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
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
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
              className="flex items-center gap-1 px-3 py-2 text-sm text-stone-400 hover:text-stone-900 transition-colors"
            >
              <X className="h-4 w-4" />
              Xóa ({activeFiltersCount})
            </button>
          )}
        </div>
      </div>

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div>
          {isLoading ? (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="rounded-xl bg-stone-50 border border-stone-200 p-5">
                  <div className="skeleton h-4 w-24 mb-3" />
                  <div className="skeleton h-5 w-full mb-2" />
                  <div className="skeleton h-8 w-20 mb-3" />
                  <div className="skeleton h-3 w-full" />
                </div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <div className="rounded-full bg-stone-50 p-4">
                <Search className="h-8 w-8 text-stone-500" />
              </div>
              <p className="font-medium text-stone-600">Không tìm thấy sản phẩm</p>
              <p className="text-sm text-stone-500">Thử thay đổi bộ lọc</p>
              {activeFiltersCount > 0 && (
                <button onClick={handleClearFilters} className="btn btn-secondary px-3 py-1.5 text-xs">
                  Xóa bộ lọc
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 stagger-children">
              {products.map((product: Product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onClick={() => handleRowClick(product)}
                  onEdit={handleEditProduct}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
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
                Array.from({ length: 8 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={7}>
                      <div className="h-10 bg-stone-50 animate-pulse rounded" />
                    </td>
                  </tr>
                ))
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="rounded-full bg-stone-50 p-4">
                        <Search className="h-8 w-8 text-stone-500" />
                      </div>
                      <div>
                        <p className="font-medium text-stone-600">Không tìm thấy sản phẩm</p>
                        <p className="text-sm text-stone-500 mt-1">Thử thay đổi bộ lọc</p>
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
                    onClick={() => handleRowClick(product)}
                    className={cn(
                      'cursor-pointer transition-colors duration-150',
                      idx % 2 === 0 && 'even:bg-stone-50'
                    )}
                  >
                    <td>
                      <span className="part-number">{product.partNumber}</span>
                    </td>
                    <td className="text-sm text-stone-700">{product.name}</td>
                    <td>
                      {product.brand ? (
                        <span
                          className={cn(
                            'badge border',
                            brandColors[product.brand] || 'bg-stone-100 text-stone-600 border-stone-600'
                          )}
                        >
                          {product.brand}
                        </span>
                      ) : (
                        <span className="text-stone-500">—</span>
                      )}
                    </td>
                    <td className="text-sm text-stone-400">{product.machineModel || '—'}</td>
                    <td>
                      {product.material ? (
                        <span
                          className={cn(
                            'badge border',
                            materialColors[product.material] || 'bg-stone-100 text-stone-600 border-stone-600'
                          )}
                        >
                          {product.material}
                        </span>
                      ) : (
                        <span className="text-stone-500">—</span>
                      )}
                    </td>
                    <td className="font-mono text-sm">{product.size || '—'}</td>
                    <td className="text-xs text-stone-500 truncate max-w-[200px]">{product.remark || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!isLoading && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between rounded-xl bg-white border border-stone-200 px-4 py-3">
          <p className="text-sm text-stone-400">
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
            <span className="text-sm text-stone-400">
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

      {/* Product Detail Slide-over */}
      <ProductDetail
        product={selectedProduct}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onEdit={handleEditProduct}
      />

      {/* Product Form Modal */}
      <ProductForm
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={handleFormSubmit}
        product={formMode === 'edit' ? selectedProduct : null}
        mode={formMode}
      />
    </div>
  )
}
