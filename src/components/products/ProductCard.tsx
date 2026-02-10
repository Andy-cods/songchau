import { Edit } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/api'

const MATERIAL_COLORS: Record<string, string> = {
  CERAMIC: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  METAL: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
  RUBBER: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  'O-RING': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
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
      className="group relative rounded-xl bg-slate-800/60 border border-slate-700/40 p-5 cursor-pointer transition-all duration-300 hover:border-brand-500/30 hover:shadow-lg hover:shadow-brand-500/5 hover:-translate-y-0.5"
    >
      {/* Quick edit button */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(product) }}
          className="p-1.5 rounded-lg bg-slate-700/80 text-slate-400 hover:text-white hover:bg-slate-600 transition-colors"
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
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-medium uppercase', MATERIAL_COLORS[product.material] || 'bg-slate-700/50 text-slate-400 border-slate-600/50')}>
            {product.material}
          </span>
        )}
      </div>

      {/* Product name */}
      <h4 className="text-sm font-medium text-slate-200 mb-2 line-clamp-1">{product.name}</h4>

      {/* Size display */}
      {product.size && (
        <p className="font-mono text-lg font-bold text-slate-100 mb-2">{product.size}</p>
      )}

      {/* Meta: brand + model */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {product.brand && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-[10px] font-medium text-blue-400">
            {product.brand}
          </span>
        )}
        {product.machineModel && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-700/50 border border-slate-600/50 text-[10px] font-medium text-slate-400">
            {product.machineModel}
          </span>
        )}
      </div>

      {/* Footer: stock + price */}
      <div className="pt-3 border-t border-slate-700/40 flex items-center justify-between">
        <span className="text-xs text-slate-500">
          Tồn: <span className={cn('font-medium', product.stockQuantity > 0 ? 'text-green-400' : 'text-slate-500')}>{product.stockQuantity}</span>
        </span>
        {product.sellingPrice ? (
          <span className="text-xs font-semibold text-vibrant-green">
            {new Intl.NumberFormat('vi-VN').format(product.sellingPrice)}
          </span>
        ) : (
          <span className="text-xs text-slate-600">—</span>
        )}
      </div>
    </div>
  )
}
