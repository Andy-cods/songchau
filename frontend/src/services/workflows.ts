import { api } from '@/lib/api';
import type { PaginatedResponse, Workflow, WorkflowStatus, WorkflowType } from '@/types/models';

export interface GetWorkflowsParams {
  page?: number;
  page_size?: number;
  status?: WorkflowStatus;
  search?: string;
}

// Raw row shape returned by `GET /api/v1/workflows` — `SELECT wi.*, u.full_name
// AS creator_name FROM workflow_instances wi ...` (backend workflow_engine.py
// list_workflows). Only the columns this page actually consumes are declared.
interface RawWorkflowRow {
  id: number;
  workflow_type: WorkflowType;
  current_status: WorkflowStatus;
  title: string;
  description: string | null;
  ref_type: string | null;
  ref_id: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  creator_name: string | null;
}

interface WorkflowsListEnvelope {
  data: {
    items: RawWorkflowRow[];
    total: number;
  };
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
  // Backend wraps the list in {"data": {"items": [...], "total": N}} and uses
  // `current_status` (not `status`) — unwrap + map here so every consumer of
  // this service keeps working against the plain `PaginatedResponse<Workflow>`
  // shape (Thang 2026-07-04 gap audit: page always rendered 0 rows before).
  const res = await api.get<WorkflowsListEnvelope>(`/api/v1/workflows${query}`);
  const rows = res.data?.items ?? [];
  const items: Workflow[] = rows.map((row) => ({
    id: String(row.id),
    workflow_type: row.workflow_type,
    reference_id: row.ref_id != null ? String(row.ref_id) : '',
    reference_type: row.ref_type ?? '',
    title: row.title,
    description: row.description ?? undefined,
    status: row.current_status,
    steps: [],
    initiated_by: row.created_by,
    initiator: row.creator_name ? { full_name: row.creator_name } : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const total = res.data?.total ?? items.length;
  const pageSize = params?.page_size ?? 20;
  return {
    items,
    total,
    page: params?.page ?? 1,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
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
