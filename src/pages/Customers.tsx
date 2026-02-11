import { useState, useEffect } from 'react'
import { Plus, Search, X, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { fetchCustomers, createCustomer, updateCustomer, type Customer } from '@/lib/api'
import CustomerDetail from '@/components/customers/CustomerDetail'
import CustomerForm from '@/components/customers/CustomerForm'
import { cn } from '@/lib/utils'
import {
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_COLORS,
  CUSTOMER_TIERS,
  TIER_COLORS,
  PROVINCES,
} from '@/lib/constants'

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [selectedProvince, setSelectedProvince] = useState('')
  const [selectedTier, setSelectedTier] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')

  // Pagination
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const limit = 20

  // UI State
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')

  // Load customers when filters change
  useEffect(() => {
    loadCustomers()
  }, [page, search, selectedType, selectedProvince, selectedTier, selectedStatus])

  const loadCustomers = async () => {
    setLoading(true)
    try {
      const response = await fetchCustomers({
        search,
        type: selectedType,
        province: selectedProvince,
        tier: selectedTier,
        status: selectedStatus,
        page,
        limit,
      })
      setCustomers(response.data)
      setTotal(response.pagination.total)
      setTotalPages(response.pagination.totalPages)
    } catch (error) {
      console.error('Failed to load customers:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleClearFilters = () => {
    setSearch('')
    setSelectedType('')
    setSelectedProvince('')
    setSelectedTier('')
    setSelectedStatus('')
    setPage(1)
  }

  const handleRowClick = (customer: Customer) => {
    setSelectedCustomer(customer)
    setIsDetailOpen(true)
  }

  const handleAddCustomer = () => {
    setFormMode('create')
    setSelectedCustomer(null)
    setIsFormOpen(true)
  }

  const handleEditCustomer = (customer: Customer) => {
    setFormMode('edit')
    setSelectedCustomer(customer)
    setIsDetailOpen(false)
    setIsFormOpen(true)
  }

  const handleFormSubmit = async (data: Partial<Customer>) => {
    try {
      if (formMode === 'create') {
        await createCustomer(data)
      } else if (selectedCustomer) {
        await updateCustomer(selectedCustomer.id, data)
      }
      loadCustomers()
    } catch (error) {
      console.error('Failed to save customer:', error)
      throw error
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-stone-900">
            Quản lý khách hàng
          </h2>
          <p className="text-sm text-stone-400 mt-1">
            {loading ? 'Đang tải...' : `${total} khách hàng`}
          </p>
        </div>
        <button
          onClick={handleAddCustomer}
          className="btn btn-primary px-4 py-2.5 text-sm"
        >
          <Plus className="h-4 w-4" />
          Thêm khách hàng
        </button>
      </div>

      {/* Summary Stats Bar */}
      {!loading && customers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
          <div className="rounded-xl bg-white border border-stone-200 p-4 text-center">
            <p className="text-2xl font-bold text-stone-900">{total}</p>
            <p className="text-xs text-stone-400 mt-1">Tổng KH</p>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">
              {customers.filter((c) => c.tier === 'A').length}
            </p>
            <p className="text-xs text-stone-400 mt-1">Tier A</p>
          </div>
          <div className="rounded-xl bg-white border border-stone-200 p-4 text-center">
            <p className="text-2xl font-bold text-stone-600">
              {customers.filter((c) => c.tier === 'B').length}
            </p>
            <p className="text-xs text-stone-400 mt-1">Tier B</p>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-lime-500/10 to-lime-600/5 border border-lime-500/20 p-4 text-center">
            <p className="text-2xl font-bold text-lime-400">
              {customers.filter((c) => c.status === 'active').length}
            </p>
            <p className="text-xs text-stone-400 mt-1">Active</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl bg-stone-50 border border-stone-200 p-4">
        <div className="grid grid-cols-5 gap-3">
          {/* Search */}
          <div className="col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, contact, phone..."
                className="w-full rounded-lg bg-stone-50 border border-stone-200 pl-9 pr-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>

          {/* Type */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">All Types</option>
            {CUSTOMER_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>

          {/* Province */}
          <select
            value={selectedProvince}
            onChange={(e) => setSelectedProvince(e.target.value)}
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">All Provinces</option>
            {PROVINCES.map((prov) => (
              <option key={prov} value={prov}>
                {prov}
              </option>
            ))}
          </select>

          {/* Tier */}
          <select
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value)}
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">All Tiers</option>
            {CUSTOMER_TIERS.map((tier) => (
              <option key={tier.value} value={tier.value}>
                {tier.label}
              </option>
            ))}
          </select>
        </div>

        {/* Clear Filters */}
        {(search || selectedType || selectedProvince || selectedTier) && (
          <button
            onClick={handleClearFilters}
            className="mt-3 flex items-center gap-2 text-sm text-stone-400 hover:text-stone-700 transition-colors"
          >
            <X className="h-4 w-4" />
            Clear all filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl bg-stone-50 border border-stone-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-stone-100/30 border-b-2 border-stone-200">
              <tr>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-stone-600 uppercase tracking-wider">
                  Company Name
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-stone-600 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-stone-600 uppercase tracking-wider">
                  Industrial Zone
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-stone-600 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-stone-600 uppercase tracking-wider">
                  Phone
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-stone-600 uppercase tracking-wider">
                  Tier
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-stone-600 uppercase tracking-wider">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-700">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-stone-400">
                    Loading customers...
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <Users className="h-8 w-8 text-stone-500" />
                      </div>
                      <div>
                        <p className="empty-state-title">No customers found</p>
                        <p className="empty-state-description mt-1">Try adjusting your search or filters</p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                customers.map((customer, idx) => (
                  <tr
                    key={customer.id}
                    onClick={() => handleRowClick(customer)}
                    className={cn(
                      'cursor-pointer transition-colors',
                      idx % 2 === 0 ? 'bg-stone-100/50' : 'bg-transparent',
                      'hover:bg-stone-200/30'
                    )}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-stone-700">
                          {customer.companyName}
                        </p>
                        {customer.companyNameLocal && (
                          <p className="text-xs text-stone-400">
                            {customer.companyNameLocal}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-block px-2 py-1 rounded border text-xs font-medium',
                          CUSTOMER_TYPE_COLORS[customer.type] ||
                            'bg-stone-100 text-stone-600 border-stone-600'
                        )}
                      >
                        {CUSTOMER_TYPES.find((t) => t.value === customer.type)?.label ||
                          customer.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-600">
                      {customer.industrialZone || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm text-stone-700">{customer.contactName || '—'}</p>
                        {customer.contactTitle && (
                          <p className="text-xs text-stone-400">{customer.contactTitle}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-600">
                      {customer.contactPhone || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {customer.tier ? (
                        <span
                          className={cn(
                            'inline-block px-2 py-1 rounded border text-xs font-medium',
                            TIER_COLORS[customer.tier] ||
                              'bg-stone-100 text-stone-600 border-stone-600'
                          )}
                        >
                          {customer.tier}
                        </span>
                      ) : (
                        <span className="text-sm text-stone-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-400">
                      {customer.notes
                        ? customer.notes.substring(0, 40) + (customer.notes.length > 40 ? '...' : '')
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-stone-200 bg-stone-50 px-4 py-3">
            <p className="text-sm text-stone-400">
              Page {page} of {totalPages} ({total} total)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Customer Detail Panel */}
      <CustomerDetail
        customer={selectedCustomer}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onEdit={handleEditCustomer}
      />

      {/* Customer Form Modal */}
      <CustomerForm
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={handleFormSubmit}
        customer={formMode === 'edit' ? selectedCustomer : null}
        mode={formMode}
      />
    </div>
  )
}
