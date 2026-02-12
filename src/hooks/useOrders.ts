import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchOrders, fetchOrder, createOrder, updateOrder, updateOrderStatus, recordPayment, deleteOrder, fetchOrderDocuments, createOrderDocument, deleteOrderDocument, type Order } from '@/lib/api'

// Query key factory
const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (filters: any) => [...orderKeys.lists(), filters] as const,
  details: () => [...orderKeys.all, 'detail'] as const,
  detail: (id: number) => [...orderKeys.details(), id] as const,
}

interface OrderFilters {
  search?: string
  status?: string
  paymentStatus?: string
  customerId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}

// Get orders list with filters
export function useOrders(filters: OrderFilters = {}) {
  return useQuery({
    queryKey: orderKeys.list(filters),
    queryFn: () => fetchOrders(filters as any),
  })
}

// Get single order
export function useOrder(id: number | null) {
  return useQuery({
    queryKey: orderKeys.detail(id!),
    queryFn: () => fetchOrder(id!),
    enabled: !!id,
  })
}

// Create order mutation
export function useCreateOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Partial<Order>) => createOrder(data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() })
    },
  })
}

// Update order mutation
export function useUpdateOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Order> }) => updateOrder(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() })
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(variables.id) })
    },
  })
}

// Update order status mutation
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => updateOrderStatus(id, status),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() })
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(variables.id) })
    },
  })
}

// Record payment mutation
export function useRecordPayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, amount }: { id: number; amount: number }) => recordPayment(id, amount),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() })
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(variables.id) })
    },
  })
}

// Delete order mutation
export function useDeleteOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() })
    },
  })
}

// ==================== ORDER DOCUMENTS ====================

// Get documents for an order
export function useOrderDocuments(orderId: number | null) {
  return useQuery({
    queryKey: [...orderKeys.detail(orderId!), 'documents'] as const,
    queryFn: () => fetchOrderDocuments(orderId!),
    enabled: !!orderId,
  })
}

// Create document mutation
export function useCreateOrderDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: number; data: { title: string; url: string; type?: string; notes?: string } }) =>
      createOrderDocument(orderId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...orderKeys.detail(variables.orderId), 'documents'] })
    },
  })
}

// Delete document mutation
export function useDeleteOrderDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orderId, docId }: { orderId: number; docId: number }) =>
      deleteOrderDocument(orderId, docId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...orderKeys.detail(variables.orderId), 'documents'] })
    },
  })
}
