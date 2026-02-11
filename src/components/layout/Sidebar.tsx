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
    <aside className="fixed left-0 top-0 h-screen w-[260px] bg-stone-950/95 backdrop-blur-xl border-r border-stone-800/50 flex flex-col">
      {/* Logo Section */}
      <div className="h-16 flex items-center px-6 border-b border-stone-800/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <span className="text-sm font-bold text-white">SC</span>
          </div>
          <div>
            <h1 className="font-display font-bold text-base text-white leading-tight">Song Châu</h1>
            <span className="text-[9px] text-brand-400 font-medium tracking-widest uppercase">CRM System</span>
          </div>
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
                  ? 'text-white bg-gradient-to-r from-brand-500/15 to-transparent border-l-[3px] border-brand-400 shadow-sm shadow-brand-500/5'
                  : 'text-stone-400 hover:text-white hover:bg-white/5 border-l-[3px] border-transparent'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn(
                    'w-5 h-5 transition-colors',
                    isActive ? 'text-brand-400' : 'text-stone-500 group-hover:text-stone-300'
                  )}
                  strokeWidth={1.5}
                />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}

        {/* Divider */}
        <div className="h-px bg-stone-800 my-3 mx-3" />

        {/* Settings */}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
              isActive
                ? 'text-white bg-brand-500/10 border-l-[3px] border-brand-400 shadow-sm shadow-brand-500/5'
                : 'text-stone-400 hover:text-white hover:bg-white/5 border-l-[3px] border-transparent'
            )
          }
        >
          {({ isActive }) => (
            <>
              <Settings
                className={cn(
                  'w-5 h-5 transition-colors',
                  isActive ? 'text-brand-400' : 'text-stone-500 group-hover:text-stone-300'
                )}
                strokeWidth={1.5}
              />
              <span>Cài đặt</span>
            </>
          )}
        </NavLink>
      </nav>

      {/* Bottom Section - User */}
      <div className="px-4 py-4 border-t border-stone-800/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center">
            <span className="text-sm font-semibold text-white">T</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">Thắng</p>
            <p className="text-xs text-stone-500 truncate">Admin</p>
          </div>
        </div>
        <div className="mt-3 text-center">
          <span className="text-[10px] text-stone-600">v1.0</span>
        </div>
      </div>
    </aside>
  )
}
