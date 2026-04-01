'use client';

import { useState, useEffect } from 'react';
import { Globe, Check, RefreshCw } from 'lucide-react';
import { getLocale, setLocale, t, type Locale } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Preview keys to display in the translation preview table
const PREVIEW_KEYS = [
  'nav.dashboard',
  'nav.purchase_orders',
  'nav.suppliers',
  'nav.inventory',
  'nav.bqms',
  'nav.reports',
  'nav.settings',
  'common.search',
  'common.create',
  'common.save',
  'common.cancel',
  'auth.login',
  'auth.logout',
];

interface LocaleOption {
  code: Locale;
  label: string;
  nativeLabel: string;
  flag: string;
}

const LOCALE_OPTIONS: LocaleOption[] = [
  { code: 'vi', label: 'Vietnamese', nativeLabel: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', label: 'English', nativeLabel: 'English', flag: '🇬🇧' },
];

export default function LanguagePage() {
  const [currentLocale, setCurrentLocale] = useState<Locale>('vi');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setCurrentLocale(getLocale());
  }, []);

  function handleSelect(locale: Locale) {
    if (locale === currentLocale) return;
    setPending(true);
    // Brief delay so the user sees the loading state before reload
    setTimeout(() => setLocale(locale), 400);
  }

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2.5 mb-1">
          <Globe className="h-5 w-5 text-indigo-600" />
          <h2 className="text-xl font-display font-bold text-slate-900">
            Ngôn ngữ / Language
          </h2>
        </div>
        <p className="text-sm text-slate-500">
          Chọn ngôn ngữ hiển thị của hệ thống — Select the display language for the system.
        </p>
      </div>

      {/* Language selector cards */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">
          Ngôn ngữ hiện tại / Current Language
        </h3>

        <div className="grid grid-cols-2 gap-3">
          {LOCALE_OPTIONS.map((option) => {
            const isActive = option.code === currentLocale;
            return (
              <button
                key={option.code}
                onClick={() => handleSelect(option.code)}
                disabled={pending}
                className={cn(
                  'relative flex flex-col items-center gap-2 p-5 rounded-xl border-2 transition-all duration-150',
                  'hover:border-indigo-400 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2',
                  isActive
                    ? 'border-indigo-600 bg-indigo-50 shadow-sm'
                    : 'border-slate-200 bg-white',
                  pending && 'opacity-60 cursor-not-allowed'
                )}
              >
                {isActive && (
                  <span className="absolute top-2.5 right-2.5 flex items-center justify-center h-5 w-5 rounded-full bg-indigo-600">
                    <Check className="h-3 w-3 text-white" />
                  </span>
                )}
                <span className="text-3xl" role="img" aria-label={option.label}>
                  {option.flag}
                </span>
                <div className="text-center">
                  <p className={cn('text-sm font-semibold', isActive ? 'text-indigo-700' : 'text-slate-800')}>
                    {option.nativeLabel}
                  </p>
                  <p className="text-xs text-slate-400">{option.label}</p>
                </div>
              </button>
            );
          })}
        </div>

        {pending && (
          <div className="flex items-center gap-2 mt-4 text-sm text-indigo-600">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Đang áp dụng / Applying...
          </div>
        )}

        {!pending && (
          <p className="mt-4 text-xs text-slate-400">
            Thay đổi ngôn ngữ sẽ tải lại trang — Language change will reload the page.
          </p>
        )}
      </div>

      {/* Translation preview table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">
          Xem trước bản dịch / Translation Preview
        </h3>

        <div className="overflow-hidden rounded-lg border border-slate-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Key
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Tiếng Việt
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  English
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {PREVIEW_KEYS.map((key, idx) => (
                <tr
                  key={key}
                  className={cn(
                    'transition-colors',
                    idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40',
                    currentLocale === 'vi'
                      ? '[&>td:nth-child(2)]:font-medium [&>td:nth-child(2)]:text-indigo-700'
                      : '[&>td:nth-child(3)]:font-medium [&>td:nth-child(3)]:text-indigo-700'
                  )}
                >
                  <td className="px-4 py-2 font-mono text-xs text-slate-400">{key}</td>
                  <td className="px-4 py-2 text-slate-700">{t(key, 'vi')}</td>
                  <td className="px-4 py-2 text-slate-700">{t(key, 'en')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-400 mt-3">
          Cột được tô đậm là ngôn ngữ đang kích hoạt — Bold column is the active language.
        </p>
      </div>

      {/* Quick apply button */}
      <div className="mt-4 flex gap-3">
        {LOCALE_OPTIONS.filter((o) => o.code !== currentLocale).map((option) => (
          <Button
            key={option.code}
            variant="outline"
            onClick={() => handleSelect(option.code)}
            disabled={pending}
            className="gap-2"
          >
            <span>{option.flag}</span>
            Switch to {option.nativeLabel}
          </Button>
        ))}
      </div>
    </div>
  );
}
