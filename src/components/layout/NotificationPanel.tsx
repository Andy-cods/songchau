import { useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Clock, AlertTriangle, Truck, CreditCard, X } from 'lucide-react'
import { useNotifications, type Notification } from '@/hooks/useNotifications'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

interface NotificationPanelProps {
  isOpen: boolean
  onClose: () => void
}

const NOTIFICATION_ICONS: Record<string, typeof Bell> = {
  follow_up: Clock,
  overdue_follow_up: AlertTriangle,
  overdue_delivery: Truck,
  pending_payment: CreditCard,
}

const NOTIFICATION_COLORS: Record<string, string> = {
  follow_up: 'bg-amber-500/20 text-amber-400',
  overdue_follow_up: 'bg-red-500/20 text-red-400',
  overdue_delivery: 'bg-red-500/20 text-red-400',
  pending_payment: 'bg-orange-500/20 text-orange-400',
}

export default function NotificationPanel({ isOpen, onClose }: NotificationPanelProps) {
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)
  const { notifications, count } = useNotifications()

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  const handleNotificationClick = (notification: Notification) => {
    if (notification.entityType === 'order' && notification.entityId) {
      navigate(`/orders/${notification.entityId}`)
    } else if (notification.entityType === 'customer' && notification.entityId) {
      navigate('/customers')
    }
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-2 w-96 rounded-xl bg-stone-900 border border-stone-700 shadow-2xl shadow-black/40 overflow-hidden z-50"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-700 bg-stone-800/50">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-stone-400" />
          <h3 className="text-sm font-semibold text-stone-200">Thông báo</h3>
          {count > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">
              {count}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-700 hover:text-stone-200 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Notifications List */}
      <div className="max-h-[400px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 px-4">
            <div className="rounded-full bg-stone-800/50 p-3">
              <Bell className="h-6 w-6 text-stone-500" />
            </div>
            <p className="text-sm text-stone-400">Không có thông báo</p>
            <p className="text-xs text-stone-500">Mọi thứ đều ổn!</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-800">
            {notifications.map((notification) => {
              const Icon = NOTIFICATION_ICONS[notification.type] || Bell
              const iconColor = NOTIFICATION_COLORS[notification.type] || 'bg-stone-700 text-stone-400'

              return (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors',
                    'hover:bg-stone-800/50',
                    notification.isOverdue && 'bg-red-500/5'
                  )}
                >
                  <div className={cn('rounded-lg p-2 flex-shrink-0', iconColor)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-200 truncate">
                      {notification.title}
                    </p>
                    {notification.description && (
                      <p className="text-xs text-stone-400 mt-0.5 truncate">
                        {notification.description}
                      </p>
                    )}
                    <p className="text-xs text-stone-500 mt-1">
                      {formatDistanceToNow(new Date(notification.timestamp), { addSuffix: true })}
                    </p>
                  </div>
                  {notification.isOverdue && (
                    <span className="flex-shrink-0 mt-1 inline-block w-2 h-2 rounded-full bg-red-400" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
