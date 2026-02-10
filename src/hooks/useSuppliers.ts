import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchSuppliers, fetchSupplier, createSupplier, updateSupplier, deleteSupplier, type Supplier } from '@/lib/api'

// Query key factory
const supplierKeys = {
  all: ['suppliers'] as const,
  lists: () => [...supplierKeys.all, 'list'] as const,
  list: (filters: any) => [...supplierKeys.lists(), filters] as const,
  details: () => [...supplierKeys.all, 'detail'] as const,
  detail: (id: number) => [...supplierKeys.details(), id] as const,
}

interface SupplierFilters {
  search?: string
  country?: string
  platform?: string
  status?: string
  minRating?: number
  page?: number
  limit?: number
}

// Get suppliers list with filters
export function useSuppliers(filters: SupplierFilters = {}) {
  return useQuery({
    queryKey: supplierKeys.list(filters),
    queryFn: () => fetchSuppliers(filters),
  })
}

// Get single supplier
export function useSupplier(id: number | null) {
  return useQuery({
    queryKey: supplierKeys.detail(id!),
    queryFn: () => fetchSupplier(id!),
    enabled: !!id,
  })
}

// Create supplier mutation
export function useCreateSupplier() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Partial<Supplier>) => createSupplier(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.lists() })
    },
  })
}

// Update supplier mutation
export function useUpdateSupplier() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Supplier> }) => updateSupplier(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.lists() })
      queryClient.invalidateQueries({ queryKey: supplierKeys.detail(variables.id) })
    },
  })
}

// Delete supplier mutation
export function useDeleteSupplier() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteSupplier(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.lists() })
    },
  })
}
