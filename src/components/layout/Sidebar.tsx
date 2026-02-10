import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Search,
  Package,
  Users,
  Factory,
  FileText,
  ClipboardList,
  BarChart3,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { to: '/product-lookup', icon: Search, label: 'Tra cứu nhanh' },
  { to: '/products', icon: Package, label: 'Sản phẩm' },
  { to: '/customers', icon: Users, label: 'Khách hàng' },
  { to: '/suppliers', icon: Factory, label: 'Nhà cung cấp' },
  { to: '/quotations', icon: FileText, label: 'Báo giá' },
  { to: '/orders', icon: ClipboardList, label: 'Đơn hàng' },
  { to: '/pipeline', icon: BarChart3, label: 'Pipeline' },
]

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-[260px] bg-slate-950 border-r border-slate-800/50 flex flex-col">
      {/* Logo Section */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800/50">
        <div className="flex items-center gap-2">
          <h1 className="font-display font-bold text-lg text-white">Song Châu</h1>
          <span className="text-[10px] bg-brand-500/20 text-brand-400 px-1.5 py-0.5 rounded-full font-medium tracking-wider uppercase">
            CRM
          </span>
        </div>
      </div>

      {/* Navigation Section */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                isActive
                  ? 'text-white bg-brand-500/10 border-l-2 border-brand-500'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn(
                    'w-5 h-5 transition-colors',
                    isActive ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300'
                  )}
                  strokeWidth={1.5}
                />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}

        {/* Divider */}
        <div className="h-px bg-slate-800 my-3 mx-3" />

        {/* Settings */}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
              isActive
                ? 'text-white bg-brand-500/10 border-l-2 border-brand-500'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            )
          }
        >
          {({ isActive }) => (
            <>
              <Settings
                className={cn(
                  'w-5 h-5 transition-colors',
                  isActive ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300'
                )}
                strokeWidth={1.5}
              />
              <span>Cài đặt</span>
            </>
          )}
        </NavLink>
      </nav>

      {/* Bottom Section - User */}
      <div className="px-4 py-4 border-t border-slate-800/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center">
            <span className="text-sm font-semibold text-white">T</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">Thắng</p>
            <p className="text-xs text-slate-500 truncate">Admin</p>
          </div>
        </div>
        <div className="mt-3 text-center">
          <span className="text-[10px] text-slate-600">v1.0</span>
        </div>
      </div>
    </aside>
  )
}
