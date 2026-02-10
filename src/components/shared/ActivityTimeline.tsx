import { useState } from 'react'
import { format, formatDistanceToNow, isPast } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Plus, Phone, Mail, MapPin, Users, FileText, MessageCircle, ShoppingCart, DollarSign, Bell, Check } from 'lucide-react'
import type { Activity } from '@/lib/api'
import { ACTIVITY_TYPES } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface ActivityTimelineProps {
  activities: Activity[]
  onAddActivity: (activity: Partial<Activity>) => Promise<void>
  onMarkDone: (id: number) => Promise<void>
}

const activityIcons: Record<string, typeof Phone> = {
  call: Phone,
  email: Mail,
  visit: MapPin,
  meeting: Users,
  note: FileText,
  wechat: MessageCircle,
  zalo: MessageCircle,
  quotation_sent: FileText,
  order_placed: ShoppingCart,
  payment_received: DollarSign,
  follow_up: Bell,
}

export default function ActivityTimeline({
  activities,
  onAddActivity,
  onMarkDone,
}: ActivityTimelineProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [formData, setFormData] = useState({
    type: 'note',
    title: '',
    content: '',
    followUpAt: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.content.trim()) return

    setIsSubmitting(true)
    try {
      await onAddActivity({
        type: formData.type,
        title: formData.title || null,
        content: formData.content,
        followUpAt: formData.followUpAt || null,
        followUpDone: false,
      })
      setFormData({ type: 'note', title: '', content: '', followUpAt: '' })
      setIsAdding(false)
    } catch (error) {
      console.error('Failed to add activity:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const getFollowUpStatus = (activity: Activity) => {
    if (!activity.followUpAt) return null
    if (activity.followUpDone) return 'done'
    const followUpDate = new Date(activity.followUpAt)
    if (isPast(followUpDate)) return 'overdue'
    return 'pending'
  }

  return (
    <div className="space-y-4">
      {/* Add Activity Button */}
      {!isAdding && (
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Thêm hoạt động
        </button>
      )}

      {/* Add Activity Form */}
      {isAdding && (
        <form
          onSubmit={handleSubmit}
          className="rounded-lg bg-slate-800/50 border border-slate-700 p-4 space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Loại hoạt động
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {ACTIVITY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Tiêu đề (tùy chọn)
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Tiêu đề ngắn gọn"
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Nội dung
            </label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              placeholder="Ghi chú về cuộc gọi, email, hoặc hoạt động..."
              rows={3}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Follow-up (tùy chọn)
            </label>
            <input
              type="datetime-local"
              value={formData.followUpAt}
              onChange={(e) => setFormData({ ...formData, followUpAt: e.target.value })}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Đang lưu...' : 'Lưu hoạt động'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAdding(false)
                setFormData({ type: 'note', title: '', content: '', followUpAt: '' })
              }}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Hủy
            </button>
          </div>
        </form>
      )}

      {/* Timeline */}
      <div className="space-y-4">
        {activities.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            Chưa có hoạt động nào
          </div>
        ) : (
          activities.map((activity, idx) => {
            const Icon = activityIcons[activity.type] || FileText
            const followUpStatus = getFollowUpStatus(activity)

            return (
              <div key={activity.id} className="flex gap-3">
                {/* Icon */}
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 border border-slate-700">
                    <Icon className="h-4 w-4 text-slate-400" />
                  </div>
                  {idx < activities.length - 1 && (
                    <div className="w-px flex-1 bg-slate-700 mt-2" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pb-6">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      {activity.title && (
                        <p className="text-sm font-medium text-slate-200">
                          {activity.title}
                        </p>
                      )}
                      <p className="text-xs text-slate-400">
                        {ACTIVITY_TYPES.find((t) => t.value === activity.type)?.label ||
                          activity.type}{' '}
                        · {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true, locale: vi })}
                      </p>
                    </div>
                  </div>

                  {activity.content && (
                    <p className="text-sm text-slate-300 mb-2">{activity.content}</p>
                  )}

                  {/* Follow-up badge */}
                  {activity.followUpAt && (
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
                          followUpStatus === 'done' &&
                            'bg-green-500/10 text-green-400 border border-green-500/20',
                          followUpStatus === 'overdue' &&
                            'bg-red-500/10 text-red-400 border border-red-500/20',
                          followUpStatus === 'pending' &&
                            'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        )}
                      >
                        <Bell className="h-3 w-3" />
                        Follow-up:{' '}
                        {format(new Date(activity.followUpAt), 'dd/MM/yyyy HH:mm')}
                        {followUpStatus === 'overdue' && ' (Quá hạn)'}
                      </span>
                      {!activity.followUpDone && (
                        <button
                          onClick={() => onMarkDone(activity.id)}
                          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          <Check className="h-3 w-3" />
                          Hoàn thành
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
