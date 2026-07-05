// Base path bake lúc build (NEXT_PUBLIC_BASE_PATH ← APP_BASE_PATH trong Dockerfile):
//   '' → domain riêng vendor.songchau.vn (phục vụ tại root)
//   '/ncc' → bản xem-trước trên erp.songchau.vn/ncc
// Dùng CHO redirect TUYỆT ĐỐI: window.location.href và next/navigation redirect()
// vì Next KHÔNG tự chèn basePath cho 2 API này. <Link>/router.push tự chèn basePath
// nên KHÔNG cần BP. Trước đây 8 chỗ hardcode '/ncc/...' → domain root bị 404.
export const BP = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
