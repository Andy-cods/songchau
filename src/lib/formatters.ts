import { formatDistanceToNow, format as formatDate } from 'date-fns'
import { vi } from 'date-fns/locale'

/**
 * Format number as Vietnamese currency
 * @example formatVND(1500000) // "1.500.000 ₫"
 */
export function formatVND(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('vi-VN').format(amount) + ' ₫'
}

/**
 * Format number as compact Vietnamese currency
 * @example formatCompactVND(1500000) // "1,5Tr ₫"
 */
export function formatCompactVND(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('vi-VN', { notation: 'compact', compactDisplay: 'short' }).format(amount) + ' ₫'
}

/**
 * Format number as USD
 * @example formatUSD(1500) // "$1,500"
 */
export function formatUSD(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return '$' + new Intl.NumberFormat('en-US').format(amount)
}

/**
 * Format number as CNY
 * @example formatCNY(1500) // "¥1,500"
 */
export function formatCNY(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return '¥' + new Intl.NumberFormat('zh-CN').format(amount)
}

/**
 * Format number with thousand separators
 * @example formatNumber(1500000) // "1,500,000"
 */
export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return '—'
  return new Intl.NumberFormat('vi-VN').format(num)
}

/**
 * Format date as dd/MM/yyyy
 * @example formatDateVN(new Date()) // "09/02/2026"
 */
export function formatDateVN(date: Date | string | null | undefined): string {
  if (!date) return '—'
  return formatDate(new Date(date), 'dd/MM/yyyy')
}

/**
 * Format date as dd/MM/yyyy HH:mm
 * @example formatDateTimeVN(new Date()) // "09/02/2026 14:30"
 */
export function formatDateTimeVN(date: Date | string | null | undefined): string {
  if (!date) return '—'
  return formatDate(new Date(date), 'dd/MM/yyyy HH:mm')
}

/**
 * Format date with time
 * @example formatDateWithTime(new Date()) // "09/02/2026 lúc 14:30"
 */
export function formatDateWithTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  return formatDate(new Date(date), 'dd/MM/yyyy') + ' lúc ' + formatDate(new Date(date), 'HH:mm')
}

/**
 * Format date as relative time
 * @example formatTimeAgo(new Date()) // "vài giây trước"
 */
export function formatTimeAgo(date: Date | string | null | undefined): string {
  if (!date) return '—'
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: vi })
}

/**
 * Format file size
 * @example formatFileSize(1536) // "1.5 KB"
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * Format percentage
 * @example formatPercent(0.1234) // "12.34%"
 */
export function formatPercent(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined) return '—'
  return (value * 100).toFixed(decimals) + '%'
}

/**
 * Format phone number (Vietnamese format)
 * @example formatPhone("0123456789") // "0123 456 789"
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—'
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 10) {
    return cleaned.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3')
  }
  return phone
}

/**
 * Format part number with consistent styling
 * @example formatPartNumber("AA058") // Applies mono font styling
 */
export function formatPartNumber(partNumber: string | null | undefined): string {
  if (!partNumber) return '—'
  return partNumber.toUpperCase()
}

/**
 * Truncate text with ellipsis
 * @example truncate("Very long text here", 10) // "Very long..."
 */
export function truncate(text: string | null | undefined, length: number): string {
  if (!text) return '—'
  if (text.length <= length) return text
  return text.substring(0, length) + '...'
}

/**
 * Get initials from name
 * @example getInitials("Nguyen Van A") // "NVA"
 */
export function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .substring(0, 3)
}

/**
 * Format order status to Vietnamese
 */
export function formatOrderStatus(status: string): string {
  const statusMap: Record<string, string> = {
    confirmed: 'Đã xác nhận',
    purchasing: 'Đang mua hàng',
    in_transit: 'Đang vận chuyển',
    quality_check: 'Kiểm tra chất lượng',
    delivered: 'Đã giao',
    completed: 'Hoàn thành',
    cancelled: 'Đã hủy',
  }
  return statusMap[status] || status
}

/**
 * Format payment status to Vietnamese
 */
export function formatPaymentStatus(status: string): string {
  const statusMap: Record<string, string> = {
    unpaid: 'Chưa thanh toán',
    partial: 'Thanh toán một phần',
    paid: 'Đã thanh toán',
  }
  return statusMap[status] || status
}

/**
 * Format quotation status to Vietnamese
 */
export function formatQuotationStatus(status: string): string {
  const statusMap: Record<string, string> = {
    draft: 'Nháp',
    sent: 'Đã gửi',
    viewed: 'Đã xem',
    accepted: 'Đã chấp nhận',
    rejected: 'Đã từ chối',
    expired: 'Đã hết hạn',
  }
  return statusMap[status] || status
}

/**
 * Format pipeline stage to Vietnamese
 */
export function formatPipelineStage(stage: string): string {
  const stageMap: Record<string, string> = {
    lead: 'Lead',
    qualified: 'Đã xác thực',
    proposal: 'Đề xuất',
    negotiation: 'Thương lượng',
    won: 'Thắng',
    lost: 'Thua',
  }
  return stageMap[stage] || stage
}

/**
 * Format customer type to Vietnamese
 */
export function formatCustomerType(type: string): string {
  const typeMap: Record<string, string> = {
    fdi_japan: 'FDI Nhật Bản',
    fdi_korea: 'FDI Hàn Quốc',
    fdi_china: 'FDI Trung Quốc',
    fdi_taiwan: 'FDI Đài Loan',
    fdi_other: 'FDI Khác',
    domestic: 'Trong nước',
  }
  return typeMap[type] || type
}

/**
 * Check if date is overdue
 */
export function isOverdue(date: Date | string | null | undefined): boolean {
  if (!date) return false
  return new Date(date) < new Date()
}

/**
 * Get days until date
 */
export function getDaysUntil(date: Date | string | null | undefined): number {
  if (!date) return 0
  const diff = new Date(date).getTime() - new Date().getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

/**
 * Format days until as text
 * @example formatDaysUntil(targetDate) // "Còn 3 ngày" or "Quá hạn 2 ngày"
 */
export function formatDaysUntil(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const days = getDaysUntil(date)

  if (days === 0) return 'Hôm nay'
  if (days === 1) return 'Ngày mai'
  if (days === -1) return 'Hôm qua'
  if (days > 0) return `Còn ${days} ngày`
  return `Quá hạn ${Math.abs(days)} ngày`
}
