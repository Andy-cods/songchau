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
      // W3-08 (2026-07-04): backend smart_inventory.py (mount /smart-inventory)
      // dùng SQL thật, không mock — nhưng FE lệch shape đúng ở phần dự báo
      // (chức năng cốt lõi): dashboard đọc field phẳng (total_products,
      // total_value) trong khi BE trả lồng data.kpis.* -> 4 thẻ KPI luôn 0;
      // link "xem chi tiết" dùng stock_alerts.id thay vì product_id -> điều
      // hướng sai trang; trang chi tiết [product_id] đọc forecast_30d/90d/
      // days_until_stockout nhưng BE /forecast/{id} trả tên khác hẳn
      // (reorder_point, days_of_stock_remaining, suggested_order_qty) ->
      // các field đó luôn undefined. Cần sửa contract FE<->BE trước khi coi
      // module này hoàn thiện.
      'Đã có màn hình dashboard và forecast cơ bản.',
      'Ngưỡng cảnh báo, logic dự báo và luồng xử lý cuối vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'Kho hàng', href: '/inventory' },
      { label: 'Giao hàng', href: '/bqms/deliveries' },
    ],
  },
  // W3-08 (2026-07-04): tasks + workload xác nhận hoàn thiện — CRUD/filter/
  // assign/start/complete đều dùng SQL thật, FE gọi đúng field. 2 bug nhỏ
  // phát hiện qua kiểm tra đã VÁ trong cùng đợt này: (1) tasks/page.tsx dropdown
  // "Giao cho" cho phép chọn rỗng trong khi backend bắt buộc assigned_to
  // (::uuid) -> giờ nút "Tạo công việc" disabled tới khi chọn người thật;
  // (2) tasks/workload/page.tsx đọc field completed_today không tồn tại
  // (backend trả completed_30d, đếm rolling 30 ngày chứ không phải "hôm nay")
  // -> đã đổi FE dùng đúng completed_30d + label "Xong (30 ngày)".
  {
    key: 'tasks',
    label: 'Công việc',
    routePrefixes: ['/tasks'],
    status: 'live',
    summary: 'Module này đã sẵn sàng sử dụng.',
    notes: [],
    recommendedActions: [],
  },
  {
    key: 'workload',
    label: 'Phân công',
    routePrefixes: ['/tasks/workload'],
    status: 'live',
    summary: 'Module này đã sẵn sàng sử dụng.',
    notes: [],
    recommendedActions: [],
  },
  {
    key: 'calendar',
    label: 'Lịch',
    routePrefixes: ['/calendar'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Có thể xem dữ liệu lịch, nhưng chưa phải hệ thống nghỉ phép và lịch công ty hoàn chỉnh.',
    notes: [
      // W3-08 (2026-07-04): sự kiện lịch (/calendar/events) hoạt động thật.
      // Đơn nghỉ phép: ĐÃ SỬA trong đợt này — trang này trước đây gọi thẳng
      // /api/v1/calendar/leaves* (calendar_api.py), một nguồn ghi SONG SONG
      // với HR M41 (leave_requests qua /api/v1/leave) nhưng thiếu department +
      // không trừ leave_balance + không có luật duyệt-cùng-phòng -> số dư
      // phép lệch với /hr. Đã đổi trang này sang gọi leaveApi (services/hr.ts)
      // -> /api/v1/leave làm NGUỒN DUY NHẤT; endpoint cũ đánh dấu deprecated
      // trong calendar_api.py (giữ lại, không unmount, đề phòng caller ngoài
      // chưa phát hiện). CÒN LẠI: dữ liệu leave_requests tạo qua đường cũ
      // trước ngày sửa vẫn có department=NULL trong DB — cần Thang/deploy
      // chạy backend/migrations/leave_requests_backfill_department.sql
      // (chưa chạy, ngoài phạm vi "không SSH/deploy" của đợt này) để các đơn
      // cũ đó hiện đúng trong danh sách duyệt theo phòng ở /hr.
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
      // W3-08 (2026-07-04): inbox chính (/notifications) dùng bảng notifications
      // thật, hoạt động thật. /notifications/settings KHÔNG phải trang cấu
      // hình như tên gọi — nó là bản sao inbox + modal admin gửi thông báo thủ
      // công, gọi router smart_notifications.py; router đó ĐÃ CÓ sẵn API
      // /preferences (bật/tắt theo loại, theo email) nhưng FE chưa nối vào —
      // không có toggle UI nào cho /preferences. Không có real-time push
      // (polling 90s, không phải bug — ghi chú "chưa cần gấp" trong code).
      // Ranh giới 2 hệ tạo notification (cron "canh giờ" vs event-driven) đã
      // viết rõ ở đầu backend/app/tasks/notifications.py cùng đợt này.
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
      // W3-08 (2026-07-04): email_history.py chỉ có 4 GET (list/stats/by-
      // entity/detail) — KHÔNG có endpoint ghi, và 0 job nào INSERT vào
      // email_history trong toàn repo (đồng bộ M365 Graph chưa bật, biến env
      // M365 còn trống — biết từ trước). Module chỉ đọc, chưa có nguồn dữ
      // liệu sống; M32 "Tự động đọc email" chưa xây (không có cột phân loại
      // trong bảng). Cần bật M365 + đồng bộ email trước khi coi là hoàn thiện.
      'Đã có lịch sử email và thống kê cơ bản.',
      'Phân loại nội dung và các workflow nâng cao vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'BQMS', href: '/bqms' },
      { label: 'Quản lý tài liệu', href: '/documents/browser' },
    ],
  },
  // W3-08 (2026-07-04): key 'forecast' (/analytics/forecast, M37 "Dự báo nhu
  // cầu") ĐÃ GỠ khỏi registry — Thang quyết định bỏ hẳn module này 2026-07-02
  // (xem frontend/src/lib/constants.ts NAV_ANALYTICS + trang
  // analytics/forecast/page.tsx giờ chỉ redirect('/analytics/price-trends')).
  // Backend demand_forecast.py đã gỡ khỏi router (W0-09, dead route). Không
  // còn ai thấy banner WIP của module này vì trang redirect ngay lập tức —
  // giữ entry cũ trong registry là rác, không phải "in_progress" thật.
  {
    key: 'finance-reports',
    label: 'Báo cáo TC',
    routePrefixes: ['/finance/reports'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Nên dùng như màn tham khảo nội bộ thay vì báo cáo tài chính chốt cuối.',
    notes: [
      // W3-08 (2026-07-04): backend finance_reports.py dùng SQL thật, không
      // mock — nhưng cả 3 endpoint FE gọi đều lệch shape với response BE:
      // /profit-loss trả revenue/cogs lồng object + tên field khác
      // (gross_profit_vnd, net_profit_vnd...) trong khi FE đọc field phẳng
      // -> 5 thẻ KPI hiện NaN₫; bộ chọn 3/6/12 tháng bị BE bỏ qua hoàn toàn.
      // /monthly-comparison trả {data:{monthly:[...]}} nhưng FE coi data là
      // mảng trực tiếp -> biểu đồ + bảng luôn rỗng. /top-customers tương tự
      // (BE trả {data:{customers:[...]}}). Cần sửa contract FE<->BE 3 chỗ
      // trên trước khi coi module này hoàn thiện.
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
      // W3-08 (2026-07-04): không có backend locale/i18n API nào. FE
      // lib/i18n.ts chỉ có ~26 key dịch (menu + vài từ chung) và chỉ được
      // import ở đúng trang này — setLocale() chỉ ghi localStorage rồi
      // reload(), không có provider/context nào khác trong app đọc locale
      // để dịch UI thật. Đây là trang demo cô lập, chưa phải tính năng đổi
      // ngôn ngữ hệ thống. Thiếu: locale provider áp dụng toàn app + mở rộng
      // dictionary.
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
      // W3-08 (2026-07-04): backend system_health.py /dashboard query DB/
      // Redis/disk thật, không mock — nhưng FE đọc field phẳng (db_size,
      // table_count, total_rows, redis_memory, uptime) trong khi BE trả lồng
      // (data.database.size/tables/rows, data.redis.memory) và không có field
      // uptime/containers nào cả -> hầu hết StatCard hiện "—", khối "Trạng
      // thái containers" luôn rỗng. /db-stats cũng lệch cột (BE trả
      // `tablename`, FE đọc `table_name`). Cần sửa contract FE<->BE.
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
      // W3-08 (2026-07-04): list/filter/resolve error_log hoạt động thật
      // (không mock). Vấn đề gốc: KHÔNG có pipeline nào tự ghi lỗi thật vào
      // error_log — main.py chỉ đăng ký exception_handler cho
      // RateLimitExceeded, không có global exception handler/middleware ghi
      // exception thật. Bảng sẽ luôn rỗng trừ khi ai đó tự tay INSERT. Bug
      // nhỏ thêm: FE đọc summary.last_30d nhưng BE /errors/summary không trả
      // field này (chỉ by_severity/by_type/last_7d/unresolved).
      'Danh sách lỗi đã có sẵn để theo dõi nhanh.',
      'Phân nhóm, điều hướng xử lý và cảnh báo nâng cao vẫn đang được bổ sung.',
    ],
    recommendedActions: [
      { label: 'Tổng quan', href: '/dashboard' },
      { label: 'Cài đặt', href: '/settings' },
    ],
  },
  // W3-08 (2026-07-04): migration xác nhận hoàn thiện — data_migration.py có
  // đủ 11 endpoint thật (sync-history/status/trigger, import-stats,
  // data-quality, file-tree/preview/download/import chạy scripts/
  // import_precise.py thật qua subprocess, ghi etl_sync_log), FE gọi khớp
  // toàn bộ, polling trạng thái import hoạt động thật.
  {
    key: 'migration',
    label: 'Di chuyển dữ liệu',
    routePrefixes: ['/admin/migration'],
    status: 'live',
    summary: 'Module này đã sẵn sàng sử dụng.',
    notes: [],
    recommendedActions: [],
  },
  // W3-08 (2026-07-04): containers xác nhận hoàn thiện — container_history.py
  // (/api/v1/containers) probe thật Postgres/Redis/frontend/nginx/Gotenberg/
  // worker/scheduler, FE render đúng. Lưu ý tên gọi: đây là giám sát HẠ TẦNG
  // DOCKER (sc-postgres, sc-redis, sc-worker...), không phải "lịch sử
  // container vận chuyển hàng hóa" như tên M21 gốc trong PROGRESS.md gợi ý —
  // nếu Thang cần theo dõi container hàng thật (biển số/số container XNK),
  // đó là tính năng KHÁC chưa xây, không nhầm với module này.
  {
    key: 'containers',
    label: 'Containers',
    routePrefixes: ['/admin/containers'],
    status: 'live',
    summary: 'Module này đã sẵn sàng sử dụng.',
    notes: [],
    recommendedActions: [],
  },
  {
    key: 'backups',
    label: 'Backup',
    routePrefixes: ['/admin/backups'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên các tác vụ quản trị đã có sẵn trong khi quy trình backup tiếp tục được hoàn thiện.',
    notes: [
      // W3-08 (2026-07-04): xác nhận đúng ghi chú "backup giả" trong
      // plans/master-completion/ROADMAP.md. POST /backups/create
      // (system_health.py) tự ghi rõ trong docstring/response: KHÔNG phải
      // backup đầy đủ, chỉ export schema + tối đa 1000 dòng/bảng ra JSON,
      // không verify/test-restore ("backup thật là cron pg_dump hằng đêm
      // trên server" — chưa xác nhận cron đó có chạy không, đây là API demo
      // riêng). NGHIÊM TRỌNG HƠN: route /admin/backups KHÔNG CÓ trang FE nào
      // (đã glob toàn bộ frontend/src/app/(dashboard)/admin/) — vào URL này
      // sẽ 404. Cần cả backup thật + verify/test-restore + dựng trang FE.
      'Đã có giao diện backup cơ bản.',
      'Lịch trình, khung phục hồi và theo dõi hoàn chỉnh vẫn đang được bổ sung.',
    ],
    recommendedActions: [
      { label: 'Cài đặt', href: '/settings' },
      { label: 'Người dùng', href: '/users' },
    ],
  },
  // W3-08 (2026-07-04): data-quality xác nhận hoàn thiện — data_migration.py
  // GET/POST /data-migration/data-quality chạy 5 rule SQL thật trên bảng
  // thật (users/bqms_rfq/purchase_orders/inventory/po_line_items), INSERT
  // kết quả thật, FE gọi khớp.
  {
    key: 'data-quality',
    label: 'Chất lượng DL',
    routePrefixes: ['/admin/data-quality'],
    status: 'live',
    summary: 'Module này đã sẵn sàng sử dụng.',
    notes: [],
    recommendedActions: [],
  },
  {
    key: 'security-log',
    label: 'Bảo mật',
    routePrefixes: ['/admin/security-log'],
    status: 'in_progress',
    summary:
      'Module này đang trong giai đoạn triển khai. Ưu tiên Người dùng và Cài đặt cho các tác vụ quản trị ổn định.',
    notes: [
      // W3-08 (2026-07-04): security_log_api.py query/filter/phân trang bảng
      // security_log thật (không mock). NHƯNG grep toàn repo xác nhận KHÔNG
      // có nơi nào INSERT vào security_log — không có middleware/hook ghi
      // login/logout/login_failed/permission_denied/role_change. Bảng luôn
      // rỗng trên thực tế dù có sự kiện bảo mật thật xảy ra. Cần thêm writer
      // ghi sự kiện thật trước khi coi module này hoàn thiện.
      'Đã có giao diện nhật ký cơ bản.',
      'Phân loại sự kiện, cảnh báo và điều hướng xử lý vẫn đang được hoàn thiện.',
    ],
    recommendedActions: [
      { label: 'Người dùng', href: '/users' },
      { label: 'Cài đặt', href: '/settings' },
    ],
  },
  // W3-08 (2026-07-04): audit xác nhận hoàn thiện — audit.py đọc bảng
  // audit_log thật (filter user/table/action/record/date, JOIN users), nhiều
  // writer thật: DB trigger auto_audit_log() trên 14 bảng nghiệp vụ chính +
  // writer app-level app/core/audit.py + gọi trực tiếp trong bqms.py/
  // employee_kpi.py/quarterly_invoices.py. Immutable từ migration
  // m44_audit_log_immutable.sql. FE gọi khớp.
  {
    key: 'audit',
    label: 'Audit Log',
    routePrefixes: ['/audit'],
    status: 'live',
    summary: 'Module này đã sẵn sàng sử dụng.',
    notes: [],
    recommendedActions: [],
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
