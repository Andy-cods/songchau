import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  TrendingDown,
  Package,
  FileText,
  DollarSign,
  ShoppingCart,
  Clock,
  Phone,
  Mail,
  MapPin,
  Users,
  AlertCircle,
  Plus,
  UserPlus,
  Target,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import {
  fetchDashboardStats,
  fetchRevenueByMonth,
  fetchProductsByCategory,
  fetchTopCustomers,
  fetchRecentActivities,
  fetchFollowUpReminders,
  type DashboardStats,
  type Activity,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

const CATEGORY_COLORS: Record<string, string> = {
  nozzle: '#3b82f6',
  feeder: '#8b5cf6',
  'spare-parts': '#f59e0b',
  esd: '#10b981',
  'solder-tool': '#ef4444',
  other: '#64748b',
}

const ACTIVITY_ICONS: Record<string, any> = {
  call: Phone,
  email: Mail,
  visit: MapPin,
  meeting: Users,
  note: FileText,
  wechat: Mail,
  zalo: Mail,
  quotation_sent: FileText,
  order_placed: ShoppingCart,
  payment_received: DollarSign,
  follow_up: Clock,
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [revenueData, setRevenueData] = useState<any[]>([])
  const [categoryData, setCategoryData] = useState<any[]>([])
  const [topCustomers, setTopCustomers] = useState<any[]>([])
  const [recentActivities, setRecentActivities] = useState<Activity[]>([])
  const [reminders, setReminders] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    setLoading(true)
    try {
      const [statsRes, revenueRes, categoryRes, customersRes, activitiesRes, remindersRes] =
        await Promise.all([
          fetchDashboardStats(),
          fetchRevenueByMonth(),
          fetchProductsByCategory(),
          fetchTopCustomers(),
          fetchRecentActivities(),
          fetchFollowUpReminders(),
        ])

      setStats(statsRes)
      setRevenueData(revenueRes.data)
      setCategoryData(categoryRes.data)
      setTopCustomers(customersRes.data)
      setRecentActivities(activitiesRes.data)
      setReminders(remindersRes.data)
    } catch (error) {
      console.error('Failed to load dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('vi-VN').format(amount) + ' ₫'
  }

  const formatCompactCurrency = (amount: number) => {
    return new Intl.NumberFormat('vi-VN', { notation: 'compact', compactDisplay: 'short' }).format(
      amount
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        {/* KPI Skeletons */}
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
              <div className="skeleton h-4 w-32 mb-3" />
              <div className="skeleton h-8 w-24 mb-2" />
              <div className="skeleton h-3 w-20" />
            </div>
          ))}
        </div>
        {/* Chart Skeletons */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
              <div className="skeleton h-5 w-48 mb-4" />
              <div className="skeleton h-[250px] w-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        {/* Revenue Card */}
        <div className="rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-400">Doanh thu tháng này</p>
            <DollarSign className="h-5 w-5 text-blue-400" />
          </div>
          <p className="font-display text-3xl font-bold text-slate-50">
            {stats ? formatCompactCurrency(stats.revenue.current) : '0'}
          </p>
          <div className="mt-2 flex items-center gap-1">
            {stats && stats.revenue.change >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-400" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-400" />
            )}
            <span
              className={cn(
                'text-xs font-medium',
                stats && stats.revenue.change >= 0 ? 'text-green-400' : 'text-red-400'
              )}
            >
              {stats ? Math.abs(stats.revenue.change).toFixed(1) : 0}% vs tháng trước
            </span>
          </div>
        </div>

        {/* Pending Orders Card */}
        <div
          className="rounded-xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 p-6 cursor-pointer hover:border-purple-500/40 transition-colors"
          onClick={() => navigate('/orders')}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-400">Đơn hàng đang xử lý</p>
            <ShoppingCart className="h-5 w-5 text-purple-400" />
          </div>
          <p className="font-display text-3xl font-bold text-slate-50">
            {stats?.pendingOrders || 0}
          </p>
          <p className="mt-2 text-xs text-slate-400">Click để xem chi tiết</p>
        </div>

        {/* Pending Quotations Card */}
        <div
          className="rounded-xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 p-6 cursor-pointer hover:border-amber-500/40 transition-colors"
          onClick={() => navigate('/quotations?status=sent')}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-400">Báo giá chờ phản hồi</p>
            <FileText className="h-5 w-5 text-amber-400" />
          </div>
          <p className="font-display text-3xl font-bold text-slate-50">
            {stats?.pendingQuotations || 0}
          </p>
          <p className="mt-2 text-xs text-slate-400">Click để xem chi tiết</p>
        </div>

        {/* Pipeline Value Card */}
        <div
          className="rounded-xl bg-gradient-to-br from-green-500/10 to-green-600/5 border border-green-500/20 p-6 cursor-pointer hover:border-green-500/40 transition-colors"
          onClick={() => navigate('/pipeline')}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-400">Pipeline Value</p>
            <Package className="h-5 w-5 text-green-400" />
          </div>
          <p className="font-display text-3xl font-bold text-slate-50">
            {stats ? formatCompactCurrency(stats.pipelineValue) : '0'}
          </p>
          <p className="mt-2 text-xs text-slate-400">Weighted total</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Thao tác nhanh</h3>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/quotations/new')}
            className="flex items-center gap-2 rounded-lg bg-blue-600/10 border border-blue-500/20 px-4 py-2.5 text-sm font-medium text-blue-400 hover:bg-blue-600/20 hover:border-blue-500/40 transition-all"
          >
            <FileText className="h-4 w-4" />
            Tạo báo giá
          </button>
          <button
            onClick={() => navigate('/orders/new')}
            className="flex items-center gap-2 rounded-lg bg-purple-600/10 border border-purple-500/20 px-4 py-2.5 text-sm font-medium text-purple-400 hover:bg-purple-600/20 hover:border-purple-500/40 transition-all"
          >
            <ShoppingCart className="h-4 w-4" />
            Tạo đơn hàng
          </button>
          <button
            onClick={() => navigate('/customers')}
            className="flex items-center gap-2 rounded-lg bg-green-600/10 border border-green-500/20 px-4 py-2.5 text-sm font-medium text-green-400 hover:bg-green-600/20 hover:border-green-500/40 transition-all"
          >
            <UserPlus className="h-4 w-4" />
            Thêm khách hàng
          </button>
          <button
            onClick={() => navigate('/pipeline')}
            className="flex items-center gap-2 rounded-lg bg-amber-600/10 border border-amber-500/20 px-4 py-2.5 text-sm font-medium text-amber-400 hover:bg-amber-600/20 hover:border-amber-500/40 transition-all"
          >
            <Target className="h-4 w-4" />
            Tạo deal
          </button>
          <button
            onClick={() => navigate('/products')}
            className="flex items-center gap-2 rounded-lg bg-slate-700/50 border border-slate-600/50 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:border-slate-500 transition-all"
          >
            <Plus className="h-4 w-4" />
            Thêm sản phẩm
          </button>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Revenue Chart */}
        <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
          <h3 className="font-display text-lg font-semibold text-slate-50 mb-4">
            Doanh thu 6 tháng gần nhất
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={revenueData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" stroke="#94a3b8" style={{ fontSize: '12px' }} />
              <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => formatCurrency(value)}
              />
              <Bar dataKey="revenue" fill="#3b82f6" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Product Categories Chart */}
        <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
          <h3 className="font-display text-lg font-semibold text-slate-50 mb-4">
            Sản phẩm theo nhóm
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={categoryData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => entry.category}
                outerRadius={80}
                fill="#8884d8"
                dataKey="count"
              >
                {categoryData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={CATEGORY_COLORS[entry.category] || CATEGORY_COLORS.other}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Customers and Activity Feed */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Top 5 Customers */}
        <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
          <h3 className="font-display text-lg font-semibold text-slate-50 mb-4">
            Top 5 Khách hàng
          </h3>
          <div className="space-y-3">
            {topCustomers.length === 0 ? (
              <p className="text-center text-slate-500 py-4">Chưa có dữ liệu</p>
            ) : (
              topCustomers.map((customer, idx) => (
                <div
                  key={customer.customerId}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 hover:bg-slate-900 transition-colors cursor-pointer"
                  onClick={() => navigate(`/customers`)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm',
                        idx === 0
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : idx === 1
                          ? 'bg-slate-400/20 text-slate-300'
                          : idx === 2
                          ? 'bg-orange-500/20 text-orange-400'
                          : 'bg-slate-600/20 text-slate-400'
                      )}
                    >
                      {idx + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">
                        {customer.customerName}
                      </p>
                      <p className="text-xs text-slate-400">{customer.totalOrders} đơn hàng</p>
                    </div>
                  </div>
                  <p className="text-sm font-mono font-medium text-green-400">
                    {formatCompactCurrency(customer.revenue)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Activities & Follow-ups */}
        <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
          <h3 className="font-display text-lg font-semibold text-slate-50 mb-4">
            Hoạt động gần đây
          </h3>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {/* Follow-up Reminders */}
            {reminders.map((reminder) => {
              const isOverdue =
                reminder.followUpAt && new Date(reminder.followUpAt) < new Date()
              const Icon = ACTIVITY_ICONS[reminder.type] || Clock

              return (
                <div
                  key={`reminder-${reminder.id}`}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg transition-colors cursor-pointer',
                    isOverdue
                      ? 'bg-red-500/10 border border-red-500/20 hover:bg-red-500/20'
                      : 'bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20'
                  )}
                >
                  <div
                    className={cn(
                      'rounded-lg p-2',
                      isOverdue ? 'bg-red-500/20' : 'bg-amber-500/20'
                    )}
                  >
                    <AlertCircle
                      className={cn('h-4 w-4', isOverdue ? 'text-red-400' : 'text-amber-400')}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200">
                      {reminder.title || 'Follow-up reminder'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {isOverdue ? 'Overdue: ' : 'Due: '}
                      {reminder.followUpAt &&
                        formatDistanceToNow(new Date(reminder.followUpAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              )
            })}

            {/* Recent Activities */}
            {recentActivities.length === 0 && reminders.length === 0 ? (
              <p className="text-center text-slate-500 py-4">Chưa có hoạt động</p>
            ) : (
              recentActivities.slice(0, 5).map((activity) => {
                const Icon = ACTIVITY_ICONS[activity.type] || FileText

                return (
                  <div
                    key={`activity-${activity.id}`}
                    className="flex items-start gap-3 p-3 rounded-lg bg-slate-900/50 hover:bg-slate-900 transition-colors"
                  >
                    <div className="rounded-lg bg-blue-500/20 p-2">
                      <Icon className="h-4 w-4 text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200">
                        {activity.title || activity.type}
                      </p>
                      {activity.content && (
                        <p className="text-xs text-slate-400 mt-1 truncate">{activity.content}</p>
                      )}
                      <p className="text-xs text-slate-500 mt-1">
                        {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
