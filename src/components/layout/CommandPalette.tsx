import { useState, useEffect, useCallback, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ArrowRight, Package, Users, FileText, ShoppingCart, TrendingUp, Settings } from 'lucide-react'
import { fetchProducts, fetchCustomers, type Product, type Customer } from '@/lib/api'
import { cn } from '@/lib/utils'
import Fuse from 'fuse.js'

interface CommandItem {
  id: string
  title: string
  subtitle?: string
  icon: any
  action: () => void
  group: 'navigation' | 'products' | 'customers' | 'actions'
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

const NAVIGATION_ITEMS: CommandItem[] = [
  {
    id: 'nav-dashboard',
    title: 'Dashboard',
    icon: TrendingUp,
    action: () => {},
    group: 'navigation',
  },
  {
    id: 'nav-products',
    title: 'Sản phẩm',
    icon: Package,
    action: () => {},
    group: 'navigation',
  },
  {
    id: 'nav-customers',
    title: 'Khách hàng',
    icon: Users,
    action: () => {},
    group: 'navigation',
  },
  {
    id: 'nav-quotations',
    title: 'Báo giá',
    icon: FileText,
    action: () => {},
    group: 'navigation',
  },
  {
    id: 'nav-orders',
    title: 'Đơn hàng',
    icon: ShoppingCart,
    action: () => {},
    group: 'navigation',
  },
  {
    id: 'nav-pipeline',
    title: 'Pipeline',
    icon: TrendingUp,
    action: () => {},
    group: 'navigation',
  },
  {
    id: 'nav-settings',
    title: 'Cài đặt',
    icon: Settings,
    action: () => {},
    group: 'navigation',
  },
]

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [items, setItems] = useState<CommandItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)

  // Load data on mount
  useEffect(() => {
    if (isOpen) {
      loadData()
    }
  }, [isOpen])

  const loadData = async () => {
    setLoading(true)
    try {
      const [productsRes, customersRes] = await Promise.all([
        fetchProducts({ limit: 100 }),
        fetchCustomers({ limit: 100 }),
      ])
      setProducts(productsRes.data)
      setCustomers(customersRes.data)
    } catch (error) {
      console.error('Failed to load command palette data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Filter and search items
  useEffect(() => {
    if (!query.trim()) {
      setItems(NAVIGATION_ITEMS)
      setSelectedIndex(0)
      return
    }

    const filteredItems: CommandItem[] = []

    // Search navigation
    const navFuse = new Fuse(NAVIGATION_ITEMS, {
      keys: ['title'],
      threshold: 0.3,
    })
    const navResults = navFuse.search(query)
    filteredItems.push(...navResults.map((r) => r.item))

    // Search products
    const productFuse = new Fuse(products, {
      keys: ['partNumber', 'name', 'brand', 'machineModel'],
      threshold: 0.3,
    })
    const productResults = productFuse.search(query).slice(0, 5)
    filteredItems.push(
      ...productResults.map((r) => ({
        id: `product-${r.item.id}`,
        title: r.item.partNumber,
        subtitle: r.item.name,
        icon: Package,
        action: () => navigate(`/products?search=${r.item.partNumber}`),
        group: 'products' as const,
      }))
    )

    // Search customers
    const customerFuse = new Fuse(customers, {
      keys: ['companyName', 'contactName', 'contactPhone'],
      threshold: 0.3,
    })
    const customerResults = customerFuse.search(query).slice(0, 5)
    filteredItems.push(
      ...customerResults.map((r) => ({
        id: `customer-${r.item.id}`,
        title: r.item.companyName,
        subtitle: r.item.contactName || undefined,
        icon: Users,
        action: () => navigate('/customers'),
        group: 'customers' as const,
      }))
    )

    setItems(filteredItems)
    setSelectedIndex(0)
  }, [query, products, customers, navigate])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (items[selectedIndex]) {
          executeAction(items[selectedIndex])
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, items, selectedIndex, onClose])

  const executeAction = (item: CommandItem) => {
    // Execute navigation actions
    if (item.group === 'navigation') {
      const path = item.id.replace('nav-', '')
      navigate(path === 'dashboard' ? '/' : `/${path}`)
    } else {
      item.action()
    }
    onClose()
    setQuery('')
  }

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {} as Record<string, CommandItem[]>)

  const GROUP_LABELS = {
    navigation: 'Chuyển đến',
    products: 'Sản phẩm',
    customers: 'Khách hàng',
    actions: 'Hành động',
  }

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Command Palette */}
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-2xl z-50 animate-in fade-in slide-in-from-top-4 duration-200">
        <div className="mx-4 rounded-xl bg-white border border-stone-200 shadow-2xl">
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200">
            <Search className="h-5 w-5 text-stone-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm kiếm sản phẩm, khách hàng, hoặc chuyển trang..."
              className="flex-1 bg-transparent text-stone-700 placeholder-stone-500 outline-none text-sm"
              autoFocus
            />
            <kbd className="hidden sm:inline-block px-2 py-1 text-xs font-medium text-stone-400 bg-stone-100 border border-stone-200 rounded">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-y-auto p-2">
            {loading ? (
              <div className="py-8 text-center text-stone-400 text-sm">Đang tải...</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-stone-400 text-sm">
                Không tìm thấy kết quả
              </div>
            ) : (
              Object.entries(groupedItems).map(([group, groupItems]) => (
                <div key={group} className="mb-4 last:mb-0">
                  <div className="px-2 py-1 text-xs font-medium text-stone-500 uppercase tracking-wider">
                    {GROUP_LABELS[group as keyof typeof GROUP_LABELS] || group}
                  </div>
                  <div className="space-y-1">
                    {groupItems.map((item, idx) => {
                      const globalIndex = items.indexOf(item)
                      const Icon = item.icon
                      const isSelected = globalIndex === selectedIndex

                      return (
                        <button
                          key={item.id}
                          onClick={() => executeAction(item)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                            isSelected
                              ? 'bg-amber-600 text-white'
                              : 'text-stone-600 hover:bg-stone-100'
                          )}
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.title}</p>
                            {item.subtitle && (
                              <p
                                className={cn(
                                  'text-xs truncate',
                                  isSelected ? 'text-amber-200' : 'text-stone-500'
                                )}
                              >
                                {item.subtitle}
                              </p>
                            )}
                          </div>
                          {isSelected && <ArrowRight className="h-4 w-4 flex-shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-stone-200 text-xs text-stone-500">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded">↑</kbd>
                <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded">↓</kbd>
                <span className="ml-1">di chuyển</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded">↵</kbd>
                <span className="ml-1">chọn</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded">ESC</kbd>
              <span className="ml-1">đóng</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
