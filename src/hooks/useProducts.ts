import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchProducts, fetchProduct, createProduct, updateProduct, deleteProduct, fetchBrands, fetchMachineModels, type Product } from '@/lib/api'

// Query key factory
const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (filters: any) => [...productKeys.lists(), filters] as const,
  details: () => [...productKeys.all, 'detail'] as const,
  detail: (id: number) => [...productKeys.details(), id] as const,
  brands: () => [...productKeys.all, 'brands'] as const,
  models: (brand: string) => [...productKeys.all, 'models', brand] as const,
  stats: () => [...productKeys.all, 'stats'] as const,
}

interface ProductFilters {
  search?: string
  category?: string
  brand?: string
  machineModel?: string
  material?: string
  page?: number
  limit?: number
}

// Get products list with filters
export function useProducts(filters: ProductFilters = {}) {
  return useQuery({
    queryKey: productKeys.list(filters),
    queryFn: () => fetchProducts(filters),
  })
}

// Get single product
export function useProduct(id: number | null) {
  return useQuery({
    queryKey: productKeys.detail(id!),
    queryFn: () => fetchProduct(id!),
    enabled: !!id,
  })
}

// Get brands list
export function useProductBrands() {
  return useQuery({
    queryKey: productKeys.brands(),
    queryFn: fetchBrands,
  })
}

// Get models list for a brand
export function useProductModels(brand: string | null) {
  return useQuery({
    queryKey: productKeys.models(brand!),
    queryFn: () => fetchMachineModels(brand!),
    enabled: !!brand,
  })
}

// Get product stats
export function useProductStats() {
  return useQuery({
    queryKey: productKeys.stats(),
    queryFn: async () => {
      const response = await fetchProducts({ limit: 1 })
      const brandsResponse = await fetchBrands()
      return {
        totalProducts: response.pagination.total,
        totalBrands: brandsResponse.data.length,
      }
    },
  })
}

// Create product mutation
export function useCreateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Partial<Product>) => createProduct(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.lists() })
      queryClient.invalidateQueries({ queryKey: productKeys.stats() })
    },
  })
}

// Update product mutation
export function useUpdateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Product> }) => updateProduct(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: productKeys.lists() })
      queryClient.invalidateQueries({ queryKey: productKeys.detail(variables.id) })
    },
  })
}

// Delete product mutation
export function useDeleteProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.lists() })
      queryClient.invalidateQueries({ queryKey: productKeys.stats() })
    },
  })
}
