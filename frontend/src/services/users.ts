import { api } from '@/lib/api';
import type { PaginatedResponse, User, UserRole } from '@/types/models';

export interface GetUsersParams {
  page?: number;
  page_size?: number;
  search?: string;
  role?: UserRole;
  is_active?: boolean;
}

export interface CreateUserPayload {
  email: string;
  full_name: string;
  role: UserRole;
  department?: string;
  password: string;
}

export interface UpdateUserPayload {
  full_name?: string;
  role?: UserRole;
  department?: string;
  is_active?: boolean;
}

export async function getUsers(
  params?: GetUsersParams
): Promise<PaginatedResponse<User>> {
  const query = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return api.get<PaginatedResponse<User>>(`/api/v1/users${query}`);
}

export async function getUser(id: string): Promise<User> {
  return api.get<User>(`/api/v1/users/${id}`);
}

export async function createUser(data: CreateUserPayload): Promise<User> {
  return api.post<User>('/api/v1/users', data);
}

export async function updateUser(
  id: string,
  data: UpdateUserPayload
): Promise<User> {
  return api.put<User>(`/api/v1/users/${id}`, data);
}

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
