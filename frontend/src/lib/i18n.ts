export type Locale = 'vi' | 'en';

const translations: Record<Locale, Record<string, string>> = {
  vi: {
    'nav.dashboard': 'Tổng quan',
    'nav.purchase_orders': 'Đơn mua hàng',
    'nav.suppliers': 'Nhà cung cấp',
    'nav.inventory': 'Kho hàng',
    'nav.bqms': 'BQMS',
    'nav.reports': 'Báo cáo',
    'nav.settings': 'Cài đặt',
    'nav.users': 'Người dùng',
    'common.search': 'Tìm kiếm...',
    'common.create': 'Tạo mới',
    'common.save': 'Lưu',
    'common.cancel': 'Hủy',
    'common.delete': 'Xóa',
    'common.edit': 'Sửa',
    'common.loading': 'Đang tải...',
    'common.no_data': 'Không có dữ liệu',
    'common.total': 'Tổng',
    'common.status': 'Trạng thái',
    'common.actions': 'Thao tác',
    'auth.login': 'Đăng nhập',
    'auth.logout': 'Đăng xuất',
    'auth.email': 'Email',
    'auth.password': 'Mật khẩu',
  },
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.purchase_orders': 'Purchase Orders',
    'nav.suppliers': 'Suppliers',
    'nav.inventory': 'Inventory',
    'nav.bqms': 'BQMS',
    'nav.reports': 'Reports',
    'nav.settings': 'Settings',
    'nav.users': 'Users',
    'common.search': 'Search...',
    'common.create': 'Create',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.loading': 'Loading...',
    'common.no_data': 'No data',
    'common.total': 'Total',
    'common.status': 'Status',
    'common.actions': 'Actions',
    'auth.login': 'Login',
    'auth.logout': 'Logout',
    'auth.email': 'Email',
    'auth.password': 'Password',
  },
};

export function t(key: string, locale: Locale = 'vi'): string {
  return translations[locale]?.[key] || key;
}

export function getLocale(): Locale {
  if (typeof window === 'undefined') return 'vi';
  return (localStorage.getItem('locale') as Locale) || 'vi';
}

export function setLocale(locale: Locale): void {
  localStorage.setItem('locale', locale);
  window.location.reload();
}
