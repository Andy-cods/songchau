import { Edit } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/api'

const MATERIAL_COLORS: Record<string, string> = {
  CERAMIC: 'bg-stone-400/10 text-stone-600 border-stone-400/20',
  METAL: 'bg-stone-500/10 text-stone-400 border-stone-500/20',
  RUBBER: 'bg-stone-500/10 text-stone-400 border-stone-500/20',
  'O-RING': 'bg-stone-500/10 text-stone-400 border-stone-500/20',
}

interface ProductCardProps {
  product: Product
  onClick: () => void
  onEdit: (product: Product) => void
}

export default function ProductCard({ product, onClick, onEdit }: ProductCardProps) {
  return (
    <div
      onClick={onClick}
      className="group relative rounded-xl bg-white border border-stone-200 p-5 cursor-pointer transition-all duration-300 hover:border-brand-500/30 hover:shadow-lg hover:shadow-brand-500/5 hover:-translate-y-0.5"
    >
      {/* Quick edit button */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(product) }}
          className="p-1.5 rounded-lg bg-stone-200 text-stone-400 hover:text-stone-900 hover:bg-stone-200 transition-colors"
        >
          <Edit className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Part number + material */}
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-sm font-semibold text-brand-400 tracking-wide">
          {product.partNumber}
        </span>
        {product.material && (
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-medium uppercase', MATERIAL_COLORS[product.material] || 'bg-stone-100 text-stone-400 border-stone-600/50')}>
            {product.material}
          </span>
        )}
      </div>

      {/* Product name */}
      <h4 className="text-sm font-medium text-stone-700 mb-2 line-clamp-1">{product.name}</h4>

      {/* Size display */}
      {product.size && (
        <p className="font-mono text-lg font-bold text-stone-800 mb-2">{product.size}</p>
      )}

      {/* Meta: brand + model */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {product.brand && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[10px] font-medium text-amber-400">
            {product.brand}
          </span>
        )}
        {product.machineModel && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-stone-100 border border-stone-600/50 text-[10px] font-medium text-stone-400">
            {product.machineModel}
          </span>
        )}
      </div>

      {/* Footer: stock + price */}
      <div className="pt-3 border-t border-stone-200 flex items-center justify-between">
        <span className="text-xs text-stone-500">
          Tồn: <span className={cn('font-medium', product.stockQuantity > 0 ? 'text-lime-400' : 'text-stone-500')}>{product.stockQuantity}</span>
        </span>
        {product.sellingPrice ? (
          <span className="text-xs font-semibold text-amber-400">
            {new Intl.NumberFormat('vi-VN').format(product.sellingPrice)}
          </span>
        ) : (
          <span className="text-xs text-stone-600">—</span>
        )}
      </div>
    </div>
  )
}
