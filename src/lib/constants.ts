// Industrial zones in Vietnam (primarily Vinh Phuc, Bac Ninh, Ha Noi, Hai Phong, Bac Giang)
export const INDUSTRIAL_ZONES = [
  'KCN Khai Quang (Vĩnh Phúc)',
  'KCN Bình Xuyên (Vĩnh Phúc)',
  'VSIP Bắc Ninh',
  'KCN Quế Võ (Bắc Ninh)',
  'KCN Yên Phong (Bắc Ninh)',
  'KCN Đình Trám (Bắc Giang)',
  'KCN Thăng Long (Hà Nội)',
  'KCN Nomura (Hải Phòng)',
  'KCN DEEP C (Hải Phòng)',
  'KCN Tiên Sơn (Bắc Ninh)',
  'KCN Đại Đồng (Bắc Ninh)',
]

// Customer types
export const CUSTOMER_TYPES = [
  { value: 'fdi_japan', label: 'FDI-Japan' },
  { value: 'fdi_korea', label: 'FDI-Korea' },
  { value: 'fdi_china', label: 'FDI-China' },
  { value: 'fdi_taiwan', label: 'FDI-Taiwan' },
  { value: 'fdi_other', label: 'FDI-Other' },
  { value: 'domestic', label: 'Domestic' },
]

// Customer type badge colors
export const CUSTOMER_TYPE_COLORS: Record<string, string> = {
  fdi_japan: 'bg-red-500/10 text-red-400 border-red-500/20',
  fdi_korea: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  fdi_china: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  fdi_taiwan: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  fdi_other: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  domestic: 'bg-green-500/10 text-green-400 border-green-500/20',
}

// Customer tiers
export const CUSTOMER_TIERS = [
  { value: 'A', label: 'Tier A' },
  { value: 'B', label: 'Tier B' },
  { value: 'C', label: 'Tier C' },
  { value: 'D', label: 'Tier D' },
]

// Tier badge colors
export const TIER_COLORS: Record<string, string> = {
  A: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  B: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  C: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  D: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
}

// Industries
export const INDUSTRIES = [
  { value: 'electronics', label: 'Electronics' },
  { value: 'automotive', label: 'Automotive' },
  { value: 'semiconductor', label: 'Semiconductor' },
  { value: 'pcb', label: 'PCB Manufacturing' },
]

// SMT Brands
export const SMT_BRANDS = [
  'Panasonic',
  'Fuji',
  'Samsung',
  'JUKI',
  'Yamaha',
  'Hitachi',
  'Casio',
  'Sanyo',
  'ASM/Siemens',
  'Assembleon',
]

// Purchase frequency
export const PURCHASE_FREQUENCY = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'as_needed', label: 'As Needed' },
]

// Payment terms
export const PAYMENT_TERMS = [
  { value: 'cod', label: 'COD (Cash on Delivery)' },
  { value: 'net15', label: 'Net 15' },
  { value: 'net30', label: 'Net 30' },
  { value: 'net45', label: 'Net 45' },
  { value: 'net60', label: 'Net 60' },
]

// Supplier countries
export const SUPPLIER_COUNTRIES = [
  { value: 'china', label: '🇨🇳 China', flag: '🇨🇳' },
  { value: 'japan', label: '🇯🇵 Japan', flag: '🇯🇵' },
  { value: 'taiwan', label: '🇹🇼 Taiwan', flag: '🇹🇼' },
  { value: 'korea', label: '🇰🇷 Korea', flag: '🇰🇷' },
  { value: 'vietnam', label: '🇻🇳 Vietnam', flag: '🇻🇳' },
]

// Supplier platforms
export const SUPPLIER_PLATFORMS = [
  { value: 'alibaba', label: 'Alibaba' },
  { value: '1688', label: '1688' },
  { value: 'direct', label: 'Direct' },
  { value: 'smtnet', label: 'SMTnet' },
  { value: 'exhibition', label: 'Exhibition' },
]

// Activity types
export const ACTIVITY_TYPES = [
  { value: 'call', label: '📞 Call', icon: 'Phone' },
  { value: 'email', label: '✉️ Email', icon: 'Mail' },
  { value: 'visit', label: '🚗 Visit', icon: 'MapPin' },
  { value: 'meeting', label: '🤝 Meeting', icon: 'Users' },
  { value: 'note', label: '📝 Note', icon: 'FileText' },
  { value: 'wechat', label: '💬 WeChat', icon: 'MessageCircle' },
  { value: 'zalo', label: '💬 Zalo', icon: 'MessageCircle' },
  { value: 'quotation_sent', label: '📄 Quotation Sent', icon: 'FileText' },
  { value: 'order_placed', label: '📦 Order Placed', icon: 'ShoppingCart' },
  { value: 'payment_received', label: '💰 Payment Received', icon: 'DollarSign' },
  { value: 'follow_up', label: '🔔 Follow-up', icon: 'Bell' },
]

// Vietnamese provinces (simplified list - common locations for SMT factories)
export const PROVINCES = [
  'Vĩnh Phúc',
  'Bắc Ninh',
  'Bắc Giang',
  'Hà Nội',
  'Hải Phòng',
  'Hải Dương',
  'Hưng Yên',
  'Thái Nguyên',
  'Quảng Ninh',
]

// Order statuses
export const ORDER_STATUSES = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'purchasing', label: 'Purchasing' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'quality_check', label: 'Quality Check' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

// Order status colors
export const ORDER_STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  purchasing: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  in_transit: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  quality_check: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  delivered: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  completed: 'bg-green-500/10 text-green-400 border-green-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
}

// Payment statuses
export const PAYMENT_STATUSES = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
]

// Payment status colors
export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  unpaid: 'bg-red-500/10 text-red-400 border-red-500/20',
  partial: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  paid: 'bg-green-500/10 text-green-400 border-green-500/20',
}

// Pipeline stages
export const PIPELINE_STAGES = [
  { value: 'lead', label: 'Lead' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
]

// Pipeline stage colors
export const PIPELINE_STAGE_COLORS: Record<string, string> = {
  lead: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  qualified: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  proposal: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  negotiation: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  won: 'bg-green-500/10 text-green-400 border-green-500/20',
  lost: 'bg-red-500/10 text-red-400 border-red-500/20',
}
