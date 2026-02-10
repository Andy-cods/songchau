import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchPipeline, fetchPipelineStats, fetchPipelineDeal, createPipelineDeal, updatePipelineDeal, updatePipelineStage, deletePipelineDeal, type PipelineDeal } from '@/lib/api'

// Query key factory
const pipelineKeys = {
  all: ['pipeline'] as const,
  lists: () => [...pipelineKeys.all, 'list'] as const,
  list: (filters: any) => [...pipelineKeys.lists(), filters] as const,
  details: () => [...pipelineKeys.all, 'detail'] as const,
  detail: (id: number) => [...pipelineKeys.details(), id] as const,
  stats: () => [...pipelineKeys.all, 'stats'] as const,
}

interface PipelineFilters {
  search?: string
  stage?: string
  customerId?: string
  page?: number
  limit?: number
}

// Get pipeline deals with filters
export function usePipeline(filters: PipelineFilters = {}) {
  return useQuery({
    queryKey: pipelineKeys.list(filters),
    queryFn: () => fetchPipeline(filters),
  })
}

// Get pipeline stats
export function usePipelineStats() {
  return useQuery({
    queryKey: pipelineKeys.stats(),
    queryFn: fetchPipelineStats,
  })
}

// Get single deal
export function useDeal(id: number | null) {
  return useQuery({
    queryKey: pipelineKeys.detail(id!),
    queryFn: () => fetchPipelineDeal(id!),
    enabled: !!id,
  })
}

// Create deal mutation
export function useCreateDeal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Partial<PipelineDeal>) => createPipelineDeal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pipelineKeys.lists() })
      queryClient.invalidateQueries({ queryKey: pipelineKeys.stats() })
    },
  })
}

// Update deal mutation
export function useUpdateDeal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<PipelineDeal> }) => updatePipelineDeal(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: pipelineKeys.lists() })
      queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(variables.id) })
      queryClient.invalidateQueries({ queryKey: pipelineKeys.stats() })
    },
  })
}

// Update deal stage mutation (for drag & drop)
export function useUpdateDealStage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, stage, lostReason, quotationId }: { id: number; stage: string; lostReason?: string; quotationId?: number }) =>
      updatePipelineStage(id, stage, lostReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pipelineKeys.lists() })
      queryClient.invalidateQueries({ queryKey: pipelineKeys.stats() })
    },
  })
}

// Delete deal mutation
export function useDeleteDeal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deletePipelineDeal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pipelineKeys.lists() })
      queryClient.invalidateQueries({ queryKey: pipelineKeys.stats() })
    },
  })
}
