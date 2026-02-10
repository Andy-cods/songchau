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
  BarChart3,
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
  AreaChart,
  Area,
} from 'recharts'
import {
  fetchDashboardStats,
  fetchRevenueByMonth,
  fetchProductsByCategory,
  fetchTopCustomers,
  fetchRecentActivities,
  fetchFollowUpReminders,
  fetchCustomerAcquisition,
  type DashboardStats,
  type Activity,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import AnimatedNumber from '@/components/shared/AnimatedNumber'

const CATEGORY_COLORS: Record<string, string> = {
  nozzle: '#3b82f6',
  feeder: '#8b5cf6',
  'spare-parts': '#f59e0b',
  esd: '#10b981',
  'solder-tool': '#ef4444',
  sensor: '#06b6d4',
  filter: '#ec4899',
  valve: '#f97316',
  belt: '#84cc16',
  cutter: '#6366f1',
  motor: '#14b8a6',
  camera: '#a855f7',
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
  const [acquisitionData, setAcquisitionData] = useState<{ month: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    setLoading(true)
    try {
      const [statsRes, revenueRes, categoryRes, customersRes, activitiesRes, remindersRes, acquisitionRes] =
        await Promise.all([
          fetchDashboardStats(),
          fetchRevenueByMonth(),
          fetchProductsByCategory(),
          fetchTopCustomers(),
          fetchRecentActivities(),
          fetchFollowUpReminders(),
          fetchCustomerAcquisition(),
        ])

      setStats(statsRes)
      setRevenueData(revenueRes.data)
      setCategoryData(categoryRes.data)
      setTopCustomers(customersRes.data)
      setRecentActivities(activitiesRes.data)
      setReminders(remindersRes.data)
      setAcquisitionData(acquisitionRes.data)
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
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
              <div className="skeleton h-4 w-32 mb-3" />
              <div className="skeleton h-8 w-24 mb-2" />
              <div className="skeleton h-3 w-20" />
            </div>
          ))}
        </div>
        {/* Chart Skeletons */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
            <div className="skeleton h-5 w-48 mb-4" />
            <div className="skeleton h-[280px] w-full" />
          </div>
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
            <div className="skeleton h-5 w-48 mb-4" />
            <div className="skeleton h-[280px] w-full" />
          </div>
        </div>
      </div>
    )
  }

  // Find max revenue for top customer bar visual
  const maxRevenue = topCustomers.length > 0 ? Math.max(...topCustomers.map((c) => c.revenue)) : 1

  return (
    <div className="space-y-6 page-transition">
      {/* KPI Cards - 6 cards in 3 columns */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 stagger-children">
        {/* Revenue Card */}
        <div className="rounded-xl bg-gradient-to-br from-blue-500/15 to-blue-600/5 border border-blue-500/20 p-6 shadow-lg shadow-blue-500/5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-400">Doanh thu tháng này</p>
            <div className="rounded-lg bg-blue-500/20 p-2">
              <DollarSign className="h-5 w-5 text-blue-400" />
            </div>
          </div>
          <p className="font-display text-3xl font-bold text-slate-50">
            <AnimatedNumber
              value={stats?.revenue.current || 0}
              formatter={formatCompactCurrency}
            />
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
          className="rounded-xl bg-gradient-to-br from-purple-500/15 to-purple-600/5 border border-purple-500/20 p-6 cursor-pointer hover:border-purple-500/40 transition-all shadow-lg shadow-purple-500/5 hover:shadow-xl hover:shadow-purple-500/10"
          onClick={() => navigate('/orders')}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-400">Đơn hàng đang xử lý</p>
            <div className="rounded-lg bg-purple-500/20 p-2">
              <ShoppingCart className="h-5 w-5 text-purple-400" />
            </div>
          </div>
          <p className="font-display text-3xl font-bold text-slate-50">
            <AnimatedNumber value={stats?.pendingOrders || 0} />
          </p>
          <p className="mt-2 text-xs text-slate-400">Click để xem chi tiết</p>
        </div>

        {/* Pending Quotations Card */}
        <div
          className="rounded-xl bg-gradient-to-br from-amber-500/15 to-amber-600/5 border border-amber-500/20 p-6 cursor-pointer hover:border-amber-500/40 transition-all shadow-lg shadow-amber-500/5 hover:shadow-xl hover:shadow-amber-500/10"
          onClick={() => navigate('/quotations?status=sent')}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-400">Báo giá chờ phản hồi</p>
            <div className="rounded-lg bg-amber-500/20 p-2">
              <FileText className="h-5 w-5 text-amber-400" />
            </div>
          </div>
          <p className="font-display text-3xl font-bold text-slate-50">
            <AnimatedNumber value={stats?.pendingQuotations || 0} />
          </p>
          <p className="mt-2 text-xs text-slate-400">Click để xem chi tiết</p>
        </div>

        {/* Total Customers Card */}
        <div
          className="rounded-xl bg-gradient-to-br from-cyan-500/15 to-cyan-600/5 border border-cyan-500/20 p-6 cursor-pointer hover:border-cyan-500/40 transition-all shadow-lg shadow-cyan-500/5 hover:shadow-xl hover:shadow-cyan-500/10"
          onClick={() => navigate('/customers')}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-400">Tổng khách hàng</p>
            <div className="rounded-lg bg-cyan-500/20 p-2">
              <Users className="h-5 w-5 text-cyan-400" />
            </div>
          </div>
          <p className="font-display text-3xl font-bold text-slate-50">
            <AnimatedNumber value={stats?.totalCustomers || 0} />
          </p>
          <p className="mt-2 text-xs text-slate-400">Trong hệ thống</p>
        </div>

        {/* Total Products Card */}
        <div
          className="rounded-xl bg-gradient-to-br from-green-500/15 to-green-600/5 border border-green-500/20 p-6 cursor-pointer hover:border-green-500/40 transition-all shadow-lg shadow-green-500/5 hover:shadow-xl hover:shadow-green-500/10"
          onClick={() => navigate('/products')}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-400">Tổng sản phẩm</p>
            <div className="rounded-lg bg-green-500/20 p-2">
              <Package className="h-5 w-5 text-green-400" />
            </div>
          </div>
          <p className="font-display text-3xl font-bold text-slate-50">
            <AnimatedNumber value={stats?.totalProducts || 0} />
          </p>
          <p className="mt-2 text-xs text-slate-400">Trong catalog</p>
        </div>

        {/* Pipeline Value Card */}
        <div
          className="rounded-xl bg-gradient-to-br from-rose-500/15 to-rose-600/5 border border-rose-500/20 p-6 cursor-pointer hover:border-rose-500/40 transition-all shadow-lg shadow-rose-500/5 hover:shadow-xl hover:shadow-rose-500/10"
          onClick={() => navigate('/pipeline')}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-400">Pipeline Value</p>
            <div className="rounded-lg bg-rose-500/20 p-2">
              <Target className="h-5 w-5 text-rose-400" />
            </div>
          </div>
          <p className="font-display text-3xl font-bold text-slate-50">
            <AnimatedNumber
              value={stats?.pipelineValue || 0}
              formatter={formatCompactCurrency}
            />
          </p>
          <p className="mt-2 text-xs text-slate-400">Weighted total</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-4 animate-fade-in-up">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Thao tác nhanh</h3>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => navigate('/quotations/new')}
            className="flex items-center gap-2 rounded-lg bg-blue-600/10 border border-blue-500/20 px-4 py-2.5 text-sm font-medium text-blue-400 hover:bg-blue-600/20 hover:border-blue-500/40 hover:shadow-lg hover:shadow-blue-500/10 transition-all"
          >
            <FileText className="h-4 w-4" />
            Tạo báo giá
          </button>
          <button
            onClick={() => navigate('/orders/new')}
            className="flex items-center gap-2 rounded-lg bg-purple-600/10 border border-purple-500/20 px-4 py-2.5 text-sm font-medium text-purple-400 hover:bg-purple-600/20 hover:border-purple-500/40 hover:shadow-lg hover:shadow-purple-500/10 transition-all"
          >
            <ShoppingCart className="h-4 w-4" />
            Tạo đơn hàng
          </button>
          <button
            onClick={() => navigate('/customers')}
            className="flex items-center gap-2 rounded-lg bg-green-600/10 border border-green-500/20 px-4 py-2.5 text-sm font-medium text-green-400 hover:bg-green-600/20 hover:border-green-500/40 hover:shadow-lg hover:shadow-green-500/10 transition-all"
          >
            <UserPlus className="h-4 w-4" />
            Thêm khách hàng
          </button>
          <button
            onClick={() => navigate('/pipeline')}
            className="flex items-center gap-2 rounded-lg bg-amber-600/10 border border-amber-500/20 px-4 py-2.5 text-sm font-medium text-amber-400 hover:bg-amber-600/20 hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/10 transition-all"
          >
            <Target className="h-4 w-4" />
            Tạo deal
          </button>
          <button
            onClick={() => navigate('/products')}
            className="flex items-center gap-2 rounded-lg bg-slate-700/50 border border-slate-600/50 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:border-slate-500 hover:shadow-lg transition-all"
          >
            <Plus className="h-4 w-4" />
            Thêm sản phẩm
          </button>
        </div>
      </div>

      {/* Charts Row - 3 columns */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
        {/* Revenue Chart - 2 cols */}
        <div className="lg:col-span-2 rounded-xl bg-slate-800/60 border border-slate-700/40 p-6 animate-fade-in-up">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-5 w-5 text-blue-400" />
            <h3 className="font-display text-lg font-semibold text-slate-50">
              Doanh thu 6 tháng gần nhất
            </h3>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={revenueData}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.3} />
                </linearGradient>
              </defs>
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
              <Bar dataKey="revenue" fill="url(#revenueGradient)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Customer Acquisition Chart - 1 col */}
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-6 animate-fade-in-up">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="h-5 w-5 text-green-400" />
            <h3 className="font-display text-lg font-semibold text-slate-50">
              KH mới / tháng
            </h3>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={acquisitionData}>
              <defs>
                <linearGradient id="acquisitionGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" stroke="#94a3b8" style={{ fontSize: '11px' }} />
              <YAxis stroke="#94a3b8" style={{ fontSize: '11px' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => [`${value} KH`, 'Khách hàng mới']}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#34d399"
                strokeWidth={2}
                fill="url(#acquisitionGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Second charts row */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
        {/* Product Categories Chart */}
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-6 animate-fade-in-up">
          <h3 className="font-display text-lg font-semibold text-slate-50 mb-4">
            Sản phẩm theo nhóm
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={categoryData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ category, percent }) =>
                  percent > 0.05 ? `${category} (${(percent * 100).toFixed(0)}%)` : ''
                }
                outerRadius={85}
                innerRadius={40}
                fill="#8884d8"
                dataKey="count"
                paddingAngle={2}
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
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top 5 Customers - 2 cols */}
        <div className="lg:col-span-2 rounded-xl bg-slate-800/60 border border-slate-700/40 p-6 animate-fade-in-up">
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
                  className="flex items-center gap-4 p-3 rounded-lg bg-slate-900/50 hover:bg-slate-900 transition-colors cursor-pointer group"
                  onClick={() => navigate(`/customers`)}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm shrink-0',
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
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">
                      {customer.customerName}
                    </p>
                    <p className="text-xs text-slate-400">{customer.totalOrders} đơn hàng</p>
                  </div>
                  {/* Revenue bar visual */}
                  <div className="w-32 h-2 rounded-full bg-slate-700/50 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
                      style={{ width: `${(customer.revenue / maxRevenue) * 100}%` }}
                    />
                  </div>
                  <p className="text-sm font-mono font-medium text-green-400 shrink-0">
                    {formatCompactCurrency(customer.revenue)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-6 animate-fade-in-up">
        <h3 className="font-display text-lg font-semibold text-slate-50 mb-4">
          Hoạt động & Nhắc nhở
        </h3>
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {/* Follow-up Reminders */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nhắc nhở Follow-up</h4>
            {reminders.length === 0 ? (
              <p className="text-center text-slate-500 py-4 text-sm">Không có nhắc nhở</p>
            ) : (
              reminders.slice(0, 5).map((reminder) => {
                const isOverdue =
                  reminder.followUpAt && new Date(reminder.followUpAt) < new Date()

                return (
                  <div
                    key={`reminder-${reminder.id}`}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg transition-colors',
                      isOverdue
                        ? 'bg-red-500/10 border border-red-500/20 hover:bg-red-500/20'
                        : 'bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20'
                    )}
                  >
                    <div
                      className={cn(
                        'rounded-lg p-2 shrink-0',
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
                        {isOverdue ? 'Quá hạn: ' : 'Hạn: '}
                        {reminder.followUpAt &&
                          formatDistanceToNow(new Date(reminder.followUpAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Recent Activities */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Hoạt động gần đây</h4>
            {recentActivities.length === 0 ? (
              <p className="text-center text-slate-500 py-4 text-sm">Chưa có hoạt động</p>
            ) : (
              recentActivities.slice(0, 5).map((activity) => {
                const Icon = ACTIVITY_ICONS[activity.type] || FileText

                return (
                  <div
                    key={`activity-${activity.id}`}
                    className="flex items-start gap-3 p-3 rounded-lg bg-slate-900/50 hover:bg-slate-900 transition-colors"
                  >
                    <div className="rounded-lg bg-blue-500/20 p-2 shrink-0">
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
