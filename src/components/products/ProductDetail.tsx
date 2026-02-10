import { X, Edit } from 'lucide-react'
import type { Product } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ProductDetailProps {
  product: Product | null
  isOpen: boolean
  onClose: () => void
  onEdit?: (product: Product) => void
}

export default function ProductDetail({ product, isOpen, onClose, onEdit }: ProductDetailProps) {
  if (!isOpen || !product) return null

  const materialColors: Record<string, string> = {
    CERAMIC: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    METAL: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    RUBBER: 'bg-green-500/10 text-green-400 border-green-500/20',
    'O-RING': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-slate-900 border-l border-slate-700 z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-900/95 backdrop-blur border-b border-slate-700 px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-50">
              Chi tiết sản phẩm
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Mã: <span className="font-mono text-blue-400">{product.partNumber}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={() => onEdit(product)}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                <Edit className="h-4 w-4" />
                Sửa
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Main Info Card */}
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
            <h3 className="font-display text-lg font-semibold text-slate-50 mb-4">
              Thông tin sản phẩm
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Part Number
                </label>
                <p className="font-mono text-lg font-semibold text-blue-400 tracking-wide mt-1">
                  {product.partNumber}
                </p>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Name
                </label>
                <p className="text-slate-200 mt-1">{product.name}</p>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Category
                </label>
                <p className="text-slate-200 mt-1 capitalize">{product.category}</p>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Brand
                </label>
                <p className="text-slate-200 mt-1">{product.brand || '—'}</p>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Machine Model
                </label>
                <p className="text-slate-200 mt-1">{product.machineModel || '—'}</p>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Material
                </label>
                {product.material ? (
                  <span
                    className={cn(
                      'inline-block px-3 py-1 rounded-md border text-xs font-medium mt-1',
                      materialColors[product.material] || 'bg-slate-700/50 text-slate-300 border-slate-600'
                    )}
                  >
                    {product.material}
                  </span>
                ) : (
                  <p className="text-slate-200 mt-1">—</p>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Size / Spec
                </label>
                <p className="font-mono text-slate-200 mt-1">{product.size || '—'}</p>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Remark
                </label>
                <p className="text-slate-200 mt-1">{product.remark || '—'}</p>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Stock Quantity
                </label>
                <p className="text-slate-200 mt-1">{product.stockQuantity} {product.unit}</p>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Status
                </label>
                <span className={cn(
                  'inline-block px-3 py-1 rounded-md text-xs font-medium mt-1',
                  product.status === 'active'
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-gray-500/10 text-gray-400'
                )}>
                  {product.status}
                </span>
              </div>
            </div>

            {product.notes && (
              <div className="mt-6 pt-6 border-t border-slate-700">
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Notes
                </label>
                <p className="text-slate-300 mt-2">{product.notes}</p>
              </div>
            )}
          </div>

          {/* Pricing Card */}
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
            <h3 className="font-display text-lg font-semibold text-slate-50 mb-4">
              Pricing Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Cost Price
                </label>
                <p className="text-slate-200 mt-1">
                  {product.costPrice ? `${product.costPrice.toLocaleString()} ${product.costCurrency}` : '—'}
                </p>
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">
                  Selling Price
                </label>
                <p className="text-slate-200 mt-1">
                  {product.sellingPrice ? `${product.sellingPrice.toLocaleString()} ${product.sellingCurrency}` : '—'}
                </p>
              </div>
              {product.marginPercent !== null && (
                <div className="col-span-2">
                  <label className="text-xs text-slate-500 uppercase tracking-wider">
                    Margin
                  </label>
                  <p className="text-green-400 font-semibold mt-1">
                    {product.marginPercent}%
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Tabs Placeholder */}
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
            <div className="flex gap-4 border-b border-slate-700 mb-4">
              <button className="pb-3 text-sm font-medium text-blue-400 border-b-2 border-blue-400">
                Thông tin
              </button>
              <button className="pb-3 text-sm font-medium text-slate-500 hover:text-slate-300">
                Lịch sử bán
              </button>
              <button className="pb-3 text-sm font-medium text-slate-500 hover:text-slate-300">
                Nhà cung cấp
              </button>
            </div>
            <p className="text-slate-400 text-sm">Additional tabs - Coming soon</p>
          </div>
        </div>
      </div>
    </>
  )
}
