import { api } from '@/lib/api';
import type { PaginatedResponse, Workflow, WorkflowStatus } from '@/types/models';

export interface GetWorkflowsParams {
  page?: number;
  page_size?: number;
  status?: WorkflowStatus;
  search?: string;
}

export async function getWorkflows(
  params?: GetWorkflowsParams
): Promise<PaginatedResponse<Workflow>> {
  const query = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return api.get<PaginatedResponse<Workflow>>(`/api/v1/workflows${query}`);
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return api.get<Workflow>(`/api/v1/workflows/${id}`);
}

export async function approveWorkflow(
  id: string,
  comment?: string
): Promise<Workflow> {
  return api.post<Workflow>(`/api/v1/workflows/${id}/approve`, { comment });
}

export async function rejectWorkflow(
  id: string,
  comment?: string
): Promise<Workflow> {
  return api.post<Workflow>(`/api/v1/workflows/${id}/reject`, { comment });
}

export async function escalateWorkflow(
  id: string,
  comment?: string
): Promise<Workflow> {
  return api.post<Workflow>(`/api/v1/workflows/${id}/escalate`, { comment });
}
