import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchQuotations,
  fetchQuotation,
  createQuotation,
  updateQuotation,
  updateQuotationStatus,
  deleteQuotation,
  getNextQuoteNumber,
  type Quotation,
  type QuoteItem,
} from '@/lib/api'

const quotationKeys = {
  all: ['quotations'] as const,
  lists: () => [...quotationKeys.all, 'list'] as const,
  list: (filters: any) => [...quotationKeys.lists(), filters] as const,
  details: () => [...quotationKeys.all, 'detail'] as const,
  detail: (id: number) => [...quotationKeys.details(), id] as const,
  nextNumber: () => [...quotationKeys.all, 'next-number'] as const,
}

interface QuotationFilters {
  search?: string
  status?: string
  customerId?: number
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}

export function useQuotations(filters: QuotationFilters = {}) {
  return useQuery({
    queryKey: quotationKeys.list(filters),
    queryFn: () => fetchQuotations(filters),
  })
}

export function useQuotation(id: number | null) {
  return useQuery({
    queryKey: quotationKeys.detail(id!),
    queryFn: () => fetchQuotation(id!),
    enabled: !!id,
  })
}

export function useNextQuoteNumber() {
  return useQuery({
    queryKey: quotationKeys.nextNumber(),
    queryFn: getNextQuoteNumber,
    staleTime: 0,
  })
}

export function useCreateQuotation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Quotation> & { items: QuoteItem[] }) => createQuotation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quotationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: quotationKeys.nextNumber() })
    },
  })
}

export function useUpdateQuotation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Quotation> & { items?: QuoteItem[] } }) =>
      updateQuotation(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: quotationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: quotationKeys.detail(variables.id) })
    },
  })
}

export function useUpdateQuotationStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      updateQuotationStatus(id, status),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: quotationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: quotationKeys.detail(variables.id) })
    },
  })
}

export function useDeleteQuotation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteQuotation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quotationKeys.lists() })
    },
  })
}
