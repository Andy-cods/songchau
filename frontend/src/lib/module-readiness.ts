export type ModuleReadinessStatus = 'live' | 'in_progress';

export interface ModuleReadinessAction {
  label: string;
  href: string;
}

export interface ModuleReadinessEntry {
  key: string;
  label: string;
  routePrefixes: string[];
  status: ModuleReadinessStatus;
  summary: string;
  notes: string[];
  recommendedActions: ModuleReadinessAction[];
}

export interface ModuleReadinessMeta {
  label: string;
  badgeClassName: string;
  dotClassName: string;
}

const MODULE_READINESS_REGISTRY: ModuleReadinessEntry[] = [
  {
    key: 'inventory-forecast',
    label: 'Kho thông minh',
    routePrefixes: ['/inventory/forecast'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Nên đối chiếu thêm với dữ liệu kho và giao hàng thực tế trước khi ra quyết định vận hành.',
    notes: [
      'Đã có màn hình dashboard và forecast cơ bản.',
      'Ngưỡng cảnh báo, logic dự báo và luồng xử lý cuối vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'Kho hàng', href: '/inventory' },
      { label: 'Giao hàng', href: '/bqms/deliveries' },
    ],
  },
  {
    key: 'tasks',
    label: 'Công việc',
    routePrefixes: ['/tasks'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Có thể dùng để kiểm tra nội bộ, nhưng chưa nên xem là workflow phân công cuối cùng.',
    notes: [
      'Đã có task list và các thao tác cơ bản.',
      'Quy tắc phân công, theo dõi tiến độ và quy trình hoàn chỉnh vẫn đang được tinh chỉnh.',
    ],
    recommendedActions: [
      { label: 'Phân công', href: '/tasks/workload' },
      { label: 'Dashboard', href: '/dashboard' },
    ],
  },
  {
    key: 'workload',
    label: 'Phân công',
    routePrefixes: ['/tasks/workload'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Phù hợp để rà tải công việc, chưa phải màn cân bằng nguồn lực cuối cùng.',
    notes: [
      'Đã có bảng tổng hợp workload cơ bản.',
      'Các rule cân bằng tải và cảnh báo vận hành vẫn đang được bổ sung.',
    ],
    recommendedActions: [
      { label: 'Công việc', href: '/tasks' },
      { label: 'Dashboard', href: '/dashboard' },
    ],
  },
  {
    key: 'calendar',
    label: 'Lịch',
    routePrefixes: ['/calendar'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Có thể xem dữ liệu lịch, nhưng chưa phải hệ thống nghỉ phép và lịch công ty hoàn chỉnh.',
    notes: [
      'Đã có event và leave flow cơ bản.',
      'Quy trình nghiệp vụ và trạng thái vận hành cuối vẫn đang được chuẩn hóa.',
    ],
    recommendedActions: [
      { label: 'Thông báo', href: '/notifications' },
      { label: 'Dashboard', href: '/dashboard' },
    ],
  },
  {
    key: 'notifications',
    label: 'Thông báo',
    routePrefixes: ['/notifications', '/notifications/settings'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Trung tâm thông báo đã có giao diện dùng được nhưng chưa phải hệ thống notification cuối cùng.',
    notes: [
      'Đã có inbox và cấu hình cơ bản.',
      'Quy tắc cảnh báo, phân loại và đồng bộ luồng nghiệp vụ vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Công việc', href: '/tasks' },
    ],
  },
  {
    key: 'emails',
    label: 'Email Samsung',
    routePrefixes: ['/bqms/emails'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên BQMS hoặc Quản lý tài liệu nếu cần thao tác ổn định.',
    notes: [
      'Đã có lịch sử email và thống kê cơ bản.',
      'Phân loại nội dung và các workflow nâng cao vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'BQMS', href: '/bqms' },
      { label: 'Quản lý tài liệu', href: '/documents/browser' },
    ],
  },
  {
    key: 'forecast',
    label: 'Dự báo',
    routePrefixes: ['/analytics/forecast'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên Xu hướng giá hoặc BQMS khi cần dữ liệu vận hành ổn định.',
    notes: [
      'Đã có danh sách sản phẩm và luồng tạo dự báo cơ bản.',
      'Mô hình, độ tin cậy và quy trình vẫn đang được tinh chỉnh.',
    ],
    recommendedActions: [
      { label: 'Xu hướng giá', href: '/analytics/price-trends' },
      { label: 'BQMS', href: '/bqms' },
    ],
  },
  {
    key: 'finance-reports',
    label: 'Báo cáo TC',
    routePrefixes: ['/finance/reports'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Nên dùng như màn tham khảo nội bộ thay vì báo cáo tài chính chốt cuối.',
    notes: [
      'Đã có các màn báo cáo nền.',
      'Bộ KPI và các báo cáo tài chính hoàn chỉnh vẫn đang được mở rộng.',
    ],
    recommendedActions: [
      { label: 'Tài chính tổng hợp', href: '/finance/overview' },
      { label: 'Bảng kê HĐ quý', href: '/finance/quarterly-invoices' },
    ],
  },
  {
    key: 'suppliers',
    label: 'Nhà cung cấp',
    routePrefixes: ['/suppliers'],
    status: 'live',
    summary: 'Module này đã sẵn sàng sử dụng.',
    notes: [],
    recommendedActions: [],
  },
  {
    key: 'users',
    label: 'Người dùng',
    routePrefixes: ['/users'],
    status: 'live',
    summary: 'Module này đã sẵn sàng sử dụng.',
    notes: [],
    recommendedActions: [],
  },
  {
    key: 'settings',
    label: 'Cài đặt',
    routePrefixes: ['/settings'],
    status: 'live',
    summary: 'Module này đã sẵn sàng sử dụng.',
    notes: [],
    recommendedActions: [],
  },
  {
    key: 'language',
    label: 'Ngôn ngữ',
    routePrefixes: ['/settings/language'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Giao diện đổi ngôn ngữ đã có nhưng rollout đa ngôn ngữ toàn hệ thống vẫn chưa hoàn chỉnh.',
    notes: [
      'Đã có giao diện chuyển locale cơ bản.',
      'Phạm vi dịch thuật và đồng bộ các module vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'Cài đặt', href: '/settings' },
      { label: 'Dashboard', href: '/dashboard' },
    ],
  },
  {
    key: 'performance',
    label: 'Hiệu suất',
    routePrefixes: ['/admin/performance'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên Tổng quan cho các chỉ số vận hành đã ổn định.',
    notes: [
      'Đã có giao diện theo dõi cơ bản.',
      'Ngưỡng cảnh báo, drill-down và KPI mở rộng vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'Tổng quan', href: '/dashboard' },
      { label: 'Cài đặt', href: '/settings' },
    ],
  },
  {
    key: 'errors',
    label: 'Lỗi hệ thống',
    routePrefixes: ['/admin/errors'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên Tổng quan và Cài đặt cho các tác vụ vận hành cơ bản.',
    notes: [
      'Danh sách lỗi đã có sẵn để theo dõi nhanh.',
      'Phân nhóm, điều hướng xử lý và cảnh báo nâng cao vẫn đang được bổ sung.',
    ],
    recommendedActions: [
      { label: 'Tổng quan', href: '/dashboard' },
      { label: 'Cài đặt', href: '/settings' },
    ],
  },
  {
    key: 'migration',
    label: 'Di chuyển dữ liệu',
    routePrefixes: ['/admin/migration'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên Quản lý tài liệu và các danh mục song song nếu cần luồng xử lý ổn định.',
    notes: [
      'Đã mở trang theo dõi file, xem trước và xử lý từng phần.',
      'Đồng bộ tổng thể và quy trình chuẩn hóa dữ liệu vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'Quản lý tài liệu', href: '/documents/browser' },
      { label: 'Nhà cung cấp', href: '/suppliers' },
    ],
  },
  {
    key: 'containers',
    label: 'Containers',
    routePrefixes: ['/admin/containers'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên Tổng quan và Cài đặt cho các thao tác quản trị ổn định.',
    notes: [
      'Đã có giao diện quan sát cơ bản.',
      'Các thao tác điều phối và cảnh báo nâng cao vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'Tổng quan', href: '/dashboard' },
      { label: 'Cài đặt', href: '/settings' },
    ],
  },
  {
    key: 'backups',
    label: 'Backup',
    routePrefixes: ['/admin/backups'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên các tác vụ quản trị đã có sẵn trong khi quy trình backup tiếp tục được hoàn thiện.',
    notes: [
      'Đã có giao diện backup cơ bản.',
      'Lịch trình, khung phục hồi và theo dõi hoàn chỉnh vẫn đang được bổ sung.',
    ],
    recommendedActions: [
      { label: 'Cài đặt', href: '/settings' },
      { label: 'Người dùng', href: '/users' },
    ],
  },
  {
    key: 'data-quality',
    label: 'Chất lượng DL',
    routePrefixes: ['/admin/data-quality'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên Quản lý tài liệu và các danh mục chính nếu cần thao tác ổn định.',
    notes: [
      'Đã có các chỉ số và danh sách cảnh báo cơ bản.',
      'Rule kiểm tra và quy trình xử lý mở rộng vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'Quản lý tài liệu', href: '/documents/browser' },
      { label: 'Nhà cung cấp', href: '/suppliers' },
    ],
  },
  {
    key: 'security-log',
    label: 'Bảo mật',
    routePrefixes: ['/admin/security-log'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên Người dùng và Cài đặt cho các tác vụ quản trị ổn định.',
    notes: [
      'Đã có giao diện nhật ký cơ bản.',
      'Phân loại sự kiện, cảnh báo và điều hướng xử lý vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'Người dùng', href: '/users' },
      { label: 'Cài đặt', href: '/settings' },
    ],
  },
  {
    key: 'audit',
    label: 'Audit Log',
    routePrefixes: ['/audit'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên Người dùng và Cài đặt nếu cần tra cứu phục vụ vận hành hằng ngày.',
    notes: [
      'Đã có giao diện audit cơ bản.',
      'Liên kết đối tượng và bộ lọc vẫn đang được bổ sung.',
    ],
    recommendedActions: [
      { label: 'Người dùng', href: '/users' },
      { label: 'Cài đặt', href: '/settings' },
    ],
  },
];

const IN_PROGRESS_META: ModuleReadinessMeta = {
  label: 'WIP',
  badgeClassName: 'border border-amber-200 bg-amber-50 text-amber-700',
  dotClassName: 'bg-amber-500',
};

const moduleReadinessByKey = new Map(
  MODULE_READINESS_REGISTRY.map((entry) => [entry.key, entry])
);

function normalizePath(pathname: string) {
  if (!pathname) return '/';
  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return normalizedPathname.length > 1 && normalizedPathname.endsWith('/')
    ? normalizedPathname.slice(0, -1)
    : normalizedPathname;
}

function matchesRoutePrefix(pathname: string, prefix: string) {
  const normalizedPathname = normalizePath(pathname);
  const normalizedPrefix = normalizePath(prefix);
  return (
    normalizedPathname === normalizedPrefix ||
    normalizedPathname.startsWith(`${normalizedPrefix}/`)
  );
}

function getLongestMatchingPrefix(pathname: string, entry: ModuleReadinessEntry) {
  return entry.routePrefixes.reduce((longestPrefix, prefix) => {
    if (!matchesRoutePrefix(pathname, prefix)) {
      return longestPrefix;
    }
    return Math.max(longestPrefix, normalizePath(prefix).length);
  }, -1);
}

export function getModuleReadinessByKey(key: string) {
  return moduleReadinessByKey.get(key);
}

export function getModuleReadinessMeta(status: ModuleReadinessStatus) {
  if (status === 'in_progress') {
    return IN_PROGRESS_META;
  }
  return null;
}

export function getModuleReadinessByPath(pathname?: string | null) {
  if (!pathname) return undefined;

  return MODULE_READINESS_REGISTRY.map((entry) => ({
    entry,
    matchLength: getLongestMatchingPrefix(pathname, entry),
  }))
    .filter(({ matchLength }) => matchLength >= 0)
    .sort((left, right) => right.matchLength - left.matchLength)[0]?.entry;
}

export function getModuleReadinessByPathname(pathname?: string | null) {
  return getModuleReadinessByPath(pathname);
}

export function getReadableModuleLabel(pathname?: string | null) {
  return getModuleReadinessByPath(pathname)?.label ?? null;
}
