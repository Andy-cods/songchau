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
          <h2 className="font-display text-2xl font-bold text-slate-50">
            Quản lý khách hàng
          </h2>
          <p className="text-sm text-slate-400 mt-1">
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
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-4 text-center">
            <p className="text-2xl font-bold text-slate-50">{total}</p>
            <p className="text-xs text-slate-400 mt-1">Tổng KH</p>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-yellow-500/10 to-yellow-600/5 border border-yellow-500/20 p-4 text-center">
            <p className="text-2xl font-bold text-yellow-400">
              {customers.filter((c) => c.tier === 'A').length}
            </p>
            <p className="text-xs text-slate-400 mt-1">Tier A</p>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">
              {customers.filter((c) => c.tier === 'B').length}
            </p>
            <p className="text-xs text-slate-400 mt-1">Tier B</p>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-green-500/10 to-green-600/5 border border-green-500/20 p-4 text-center">
            <p className="text-2xl font-bold text-green-400">
              {customers.filter((c) => c.status === 'active').length}
            </p>
            <p className="text-xs text-slate-400 mt-1">Active</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-4">
        <div className="grid grid-cols-5 gap-3">
          {/* Search */}
          <div className="col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, contact, phone..."
                className="w-full rounded-lg bg-slate-900/50 border border-slate-700/50 pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>

          {/* Type */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
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
            className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
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
            className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
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
            <thead className="bg-slate-800/30 border-b-2 border-slate-700/50">
              <tr>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Company Name
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Industrial Zone
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Phone
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Tier
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Loading customers...
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <Users className="h-8 w-8 text-slate-500" />
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
                      idx % 2 === 0 ? 'bg-slate-900/20' : 'bg-transparent',
                      'hover:bg-slate-700/30'
                    )}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-200">
                          {customer.companyName}
                        </p>
                        {customer.companyNameLocal && (
                          <p className="text-xs text-slate-400">
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
                            'bg-slate-700/50 text-slate-300 border-slate-600'
                        )}
                      >
                        {CUSTOMER_TYPES.find((t) => t.value === customer.type)?.label ||
                          customer.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {customer.industrialZone || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm text-slate-200">{customer.contactName || '—'}</p>
                        {customer.contactTitle && (
                          <p className="text-xs text-slate-400">{customer.contactTitle}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {customer.contactPhone || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {customer.tier ? (
                        <span
                          className={cn(
                            'inline-block px-2 py-1 rounded border text-xs font-medium',
                            TIER_COLORS[customer.tier] ||
                              'bg-slate-700/50 text-slate-300 border-slate-600'
                          )}
                        >
                          {customer.tier}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">
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
