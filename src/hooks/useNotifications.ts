import { useQuery } from '@tanstack/react-query'
import { fetchFollowUpReminders, fetchOrders, type Activity, type Order } from '@/lib/api'

export interface Notification {
  id: string
  type: 'follow_up' | 'overdue_follow_up' | 'overdue_delivery' | 'pending_payment'
  title: string
  description: string
  timestamp: string
  entityType?: string
  entityId?: number
  isOverdue: boolean
}

function buildNotifications(reminders: Activity[], orders: Order[]): Notification[] {
  const now = new Date()
  const notifications: Notification[] = []

  // Follow-up reminders
  for (const reminder of reminders) {
    const isOverdue = reminder.followUpAt ? new Date(reminder.followUpAt) < now : false

    notifications.push({
      id: `reminder-${reminder.id}`,
      type: isOverdue ? 'overdue_follow_up' : 'follow_up',
      title: reminder.title || 'Follow-up reminder',
      description: reminder.content || '',
      timestamp: reminder.followUpAt || reminder.createdAt,
      entityType: reminder.entityType,
      entityId: reminder.entityId,
      isOverdue,
    })
  }

  // Overdue deliveries
  for (const order of orders) {
    if (
      order.expectedDelivery &&
      new Date(order.expectedDelivery) < now &&
      !['delivered', 'cancelled'].includes(order.status)
    ) {
      notifications.push({
        id: `delivery-${order.id}`,
        type: 'overdue_delivery',
        title: `Đơn hàng ${order.orderNumber} trễ giao`,
        description: `Khách: ${order.customerName || 'N/A'}`,
        timestamp: order.expectedDelivery,
        entityType: 'order',
        entityId: order.id,
        isOverdue: true,
      })
    }

    // Overdue payment
    if (
      order.paymentDueDate &&
      new Date(order.paymentDueDate) < now &&
      order.paymentStatus !== 'paid' &&
      order.status !== 'cancelled'
    ) {
      notifications.push({
        id: `payment-${order.id}`,
        type: 'pending_payment',
        title: `Thanh toán ${order.orderNumber} quá hạn`,
        description: `Khách: ${order.customerName || 'N/A'}`,
        timestamp: order.paymentDueDate,
        entityType: 'order',
        entityId: order.id,
        isOverdue: true,
      })
    }
  }

  // Sort: overdue first, then by timestamp descending
  notifications.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })

  return notifications
}

export function useNotifications() {
  const { data: remindersData } = useQuery({
    queryKey: ['notifications', 'reminders'],
    queryFn: fetchFollowUpReminders,
    refetchInterval: 60_000,
  })

  const { data: ordersData } = useQuery({
    queryKey: ['notifications', 'orders'],
    queryFn: () => fetchOrders({ status: 'processing', limit: 100 }),
    refetchInterval: 60_000,
  })

  const reminders = remindersData?.data || []
  const orders = ordersData?.data || []

  const notifications = buildNotifications(reminders, orders)
  const count = notifications.length

  return { notifications, count }
}
