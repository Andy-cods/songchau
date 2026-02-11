import { useState, useEffect } from 'react'
import { Save, Download, Building2, DollarSign, Hash, Database, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { fetchSettings, updateSettings, backupDatabase, type Settings } from '@/lib/api'
import { cn } from '@/lib/utils'

interface CompanyInfo {
  name: string
  nameLocal: string
  address: string
  taxCode: string
  email: string
  phone: string
}

interface CurrencySettings {
  defaultCurrency: string
  usdToVnd: number
  cnyToVnd: number
  jpyToVnd: number
}

interface FormatSettings {
  taxRate: number
  quoteNumberPrefix: string
  orderNumberPrefix: string
}

export default function Settings() {
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>({
    name: '',
    nameLocal: '',
    address: '',
    taxCode: '',
    email: '',
    phone: '',
  })

  const [currencySettings, setCurrencySettings] = useState<CurrencySettings>({
    defaultCurrency: 'VND',
    usdToVnd: 25000,
    cnyToVnd: 3500,
    jpyToVnd: 170,
  })

  const [formatSettings, setFormatSettings] = useState<FormatSettings>({
    taxRate: 10,
    quoteNumberPrefix: 'SC-Q',
    orderNumberPrefix: 'SC-PO',
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [backing, setBacking] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    setError(null)
    try {
      const { settings } = await fetchSettings()

      setCompanyInfo({
        name: settings.companyName,
        nameLocal: settings.companyNameLocal,
        address: settings.companyAddress,
        taxCode: settings.companyTaxCode,
        email: settings.companyEmail,
        phone: settings.companyPhone,
      })

      setCurrencySettings({
        defaultCurrency: settings.defaultCurrency,
        usdToVnd: Number(settings.usdToVnd),
        cnyToVnd: Number(settings.cnyToVnd),
        jpyToVnd: Number(settings.jpyToVnd),
      })

      setFormatSettings({
        taxRate: Number(settings.taxRate),
        quoteNumberPrefix: settings.quoteNumberPrefix,
        orderNumberPrefix: settings.orderNumberPrefix,
      })
    } catch (err) {
      console.error('Failed to load settings:', err)
      setError('Không thể tải cài đặt. Vui lòng thử lại.')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    setSaveSuccess(false)
    setError(null)

    try {
      const settingsToSave: Partial<Settings> = {
        companyName: companyInfo.name,
        companyNameLocal: companyInfo.nameLocal,
        companyAddress: companyInfo.address,
        companyTaxCode: companyInfo.taxCode,
        companyEmail: companyInfo.email,
        companyPhone: companyInfo.phone,
        defaultCurrency: currencySettings.defaultCurrency,
        usdToVnd: currencySettings.usdToVnd.toString(),
        cnyToVnd: currencySettings.cnyToVnd.toString(),
        jpyToVnd: currencySettings.jpyToVnd.toString(),
        taxRate: formatSettings.taxRate.toString(),
        quoteNumberPrefix: formatSettings.quoteNumberPrefix,
        orderNumberPrefix: formatSettings.orderNumberPrefix,
      }

      await updateSettings(settingsToSave)
      setSaveSuccess(true)

      // Hide success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      console.error('Failed to save settings:', err)
      setError('Không thể lưu cài đặt. Vui lòng thử lại.')
    } finally {
      setSaving(false)
    }
  }

  const handleBackupDatabase = async () => {
    setBacking(true)
    setError(null)

    try {
      const blob = await backupDatabase()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `songchau-crm-backup-${new Date().toISOString().split('T')[0]}.db`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      console.error('Backup failed:', err)
      setError('Không thể backup database. Vui lòng thử lại.')
    } finally {
      setBacking(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-display text-2xl font-bold text-stone-50">Cài đặt</h2>
        <p className="text-sm text-stone-400 mt-1">Quản lý thông tin công ty và cài đặt hệ thống</p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-400">Lỗi</p>
            <p className="text-sm text-red-300 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Success Alert */}
      {saveSuccess && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-400">Thành công</p>
            <p className="text-sm text-green-300 mt-1">Cài đặt đã được lưu thành công!</p>
          </div>
        </div>
      )}

      {/* Company Info Section */}
      <div className="rounded-xl bg-stone-800/50 border border-stone-700/50 p-6 transition-all duration-200 hover:border-stone-700">
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-lg bg-amber-500/10 p-2">
            <Building2 className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold text-stone-50">Thông tin công ty</h3>
            <p className="text-sm text-stone-400">Hiển thị trên báo giá và đơn hàng</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">
              Tên công ty (Tiếng Anh)
            </label>
            <input
              type="text"
              value={companyInfo.name}
              onChange={(e) => setCompanyInfo({ ...companyInfo, name: e.target.value })}
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">
              Tên công ty (Tiếng Việt)
            </label>
            <input
              type="text"
              value={companyInfo.nameLocal}
              onChange={(e) => setCompanyInfo({ ...companyInfo, nameLocal: e.target.value })}
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-stone-300 mb-2">Địa chỉ</label>
            <input
              type="text"
              value={companyInfo.address}
              onChange={(e) => setCompanyInfo({ ...companyInfo, address: e.target.value })}
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">Mã số thuế</label>
            <input
              type="text"
              value={companyInfo.taxCode}
              onChange={(e) => setCompanyInfo({ ...companyInfo, taxCode: e.target.value })}
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">Email</label>
            <input
              type="email"
              value={companyInfo.email}
              onChange={(e) => setCompanyInfo({ ...companyInfo, email: e.target.value })}
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">Số điện thoại</label>
            <input
              type="tel"
              value={companyInfo.phone}
              onChange={(e) => setCompanyInfo({ ...companyInfo, phone: e.target.value })}
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Currency Settings */}
      <div className="rounded-xl bg-stone-800/50 border border-stone-700/50 p-6 transition-all duration-200 hover:border-stone-700">
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-lg bg-green-500/10 p-2">
            <DollarSign className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold text-stone-50">Cài đặt tiền tệ</h3>
            <p className="text-sm text-stone-400">Tỷ giá hối đoái và tiền tệ mặc định</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">
              Tiền tệ mặc định
            </label>
            <select
              value={currencySettings.defaultCurrency}
              onChange={(e) =>
                setCurrencySettings({ ...currencySettings, defaultCurrency: e.target.value })
              }
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            >
              <option value="VND">VND (Vietnamese Dong)</option>
              <option value="USD">USD (US Dollar)</option>
              <option value="CNY">CNY (Chinese Yuan)</option>
              <option value="JPY">JPY (Japanese Yen)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">USD → VND</label>
            <input
              type="number"
              value={currencySettings.usdToVnd}
              onChange={(e) =>
                setCurrencySettings({ ...currencySettings, usdToVnd: Number(e.target.value) })
              }
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">CNY → VND</label>
            <input
              type="number"
              value={currencySettings.cnyToVnd}
              onChange={(e) =>
                setCurrencySettings({ ...currencySettings, cnyToVnd: Number(e.target.value) })
              }
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">JPY → VND</label>
            <input
              type="number"
              value={currencySettings.jpyToVnd}
              onChange={(e) =>
                setCurrencySettings({ ...currencySettings, jpyToVnd: Number(e.target.value) })
              }
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Format Settings */}
      <div className="rounded-xl bg-stone-800/50 border border-stone-700/50 p-6 transition-all duration-200 hover:border-stone-700">
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-lg bg-amber-500/10 p-2">
            <Hash className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold text-stone-50">
              Định dạng số và thuế
            </h3>
            <p className="text-sm text-stone-400">Cài đặt format cho báo giá, đơn hàng và thuế</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">
              Thuế VAT mặc định (%)
            </label>
            <input
              type="number"
              value={formatSettings.taxRate}
              onChange={(e) =>
                setFormatSettings({ ...formatSettings, taxRate: Number(e.target.value) })
              }
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">
              Prefix báo giá
            </label>
            <input
              type="text"
              value={formatSettings.quoteNumberPrefix}
              onChange={(e) =>
                setFormatSettings({ ...formatSettings, quoteNumberPrefix: e.target.value })
              }
              placeholder="SC-Q"
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
            <p className="text-xs text-stone-500 mt-1">Ví dụ: SC-Q-2026-0001</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">
              Prefix đơn hàng
            </label>
            <input
              type="text"
              value={formatSettings.orderNumberPrefix}
              onChange={(e) =>
                setFormatSettings({ ...formatSettings, orderNumberPrefix: e.target.value })
              }
              placeholder="SC-PO"
              className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
            <p className="text-xs text-stone-500 mt-1">Ví dụ: SC-PO-2026-0001</p>
          </div>
        </div>
      </div>

      {/* Database Management */}
      <div className="rounded-xl bg-stone-800/50 border border-stone-700/50 p-6 transition-all duration-200 hover:border-stone-700">
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-lg bg-amber-500/10 p-2">
            <Database className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold text-stone-50">Quản lý dữ liệu</h3>
            <p className="text-sm text-stone-400">Backup database</p>
          </div>
        </div>

        <button
          onClick={handleBackupDatabase}
          disabled={backing}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-all duration-200',
            backing
              ? 'bg-amber-500 cursor-not-allowed'
              : 'bg-amber-600 hover:bg-amber-700 hover:shadow-lg hover:shadow-amber-600/20 active:scale-95'
          )}
        >
          {backing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {backing ? 'Đang backup...' : 'Backup Database'}
        </button>
      </div>

      {/* Save Button */}
      <div className="flex justify-end sticky bottom-6 z-10">
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className={cn(
            'flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium text-white shadow-lg transition-all duration-200',
            saving
              ? 'bg-green-500 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700 shadow-green-600/20 hover:shadow-green-600/30 hover:scale-105 active:scale-95'
          )}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
        </button>
      </div>
    </div>
  )
}
