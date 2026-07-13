import { api } from '@/lib/api';
import type { UserRole } from '@/types/models';

// ─── Types ──────────────────────────────────────────────────────
//
// Thang audit #5 (2026-07-11): định nghĩa `User` cục bộ (không import từ
// '@/types/models') vì type đó thiếu `last_login_at` (cột thật, BE có SELECT
// — xem users.py list_users) và có `avatar_url` mà endpoint quản trị này
// không bao giờ trả (avatar_url chỉ có ở GET /auth/me, khác model). Chỉ
// dùng type này trong phạm vi users/**.
export interface User {
  id: string;
  email: string;
  full_name: string;
  display_name?: string | null;
  role: UserRole;
  department?: string | null;
  phone?: string | null;
  is_active: boolean;
  last_login_at?: string | null;
  created_at: string;
  updated_at?: string;
  // Pet avatar (2026-07-13): BE users.py trả pet đang làm avatar của từng
  // user (LEFT JOIN LATERAL user_pets) — null nếu chưa nuôi/chưa đặt avatar.
  pet_species?: string | null;
  pet_form?: number | null;
}

export interface CreateUserPayload {
  email: string;
  full_name: string;
  display_name?: string;
  role: UserRole;
  department?: string;
  phone?: string;
  password: string;
}

export interface UpdateUserPayload {
  full_name?: string;
  display_name?: string;
  role?: UserRole;
  department?: string;
  phone?: string;
  is_active?: boolean;
}

// BE list_users (users.py ~33-48) bỏ qua mọi filter/pagination — trả toàn bộ
// user (bảng nhỏ, ~18 nhân viên, xem COMMENT ON TABLE users). KHÔNG thêm
// page/search/role param ở đây (sẽ bị BE lờ đi, gây ảo giác lọc được — YAGNI):
// UI lọc bằng DataTable globalFilter (client-side) thay vì server-side.
// Quyết định: nếu dữ liệu tăng nhiều, cân nhắc thêm pagination thật ở BE sau.
export async function getUsers(): Promise<User[]> {
  const res = await api.get<{ data: User[] }>('/api/v1/users');
  return res.data;
}

// BE trả {"data": {...}} — unwrap tại đây (users.py get_user, mới thêm).
export async function getUser(id: string): Promise<User> {
  const res = await api.get<{ data: User }>(`/api/v1/users/${id}`);
  return res.data;
}

export async function createUser(
  data: CreateUserPayload
): Promise<{ id: string }> {
  const res = await api.post<{ data: { id: string }; message: string }>(
    '/api/v1/users',
    data
  );
  return res.data;
}

export async function updateUser(
  id: string,
  data: UpdateUserPayload
): Promise<{ message: string }> {
  return api.put(`/api/v1/users/${id}`, data);
}

// DELETE /{user_id} = soft-deactivate (BE set is_active=false), KHÔNG xoá cứng.
export async function deleteUser(id: string): Promise<void> {
  return api.delete(`/api/v1/users/${id}`);
}

export async function resetUserPassword(
  id: string,
  newPassword: string
): Promise<void> {
  return api.post(`/api/v1/users/${id}/reset-password`, {
    password: newPassword,
  });
}
