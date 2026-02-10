import { useState, useEffect, useMemo } from 'react'
import Fuse from 'fuse.js'
import type { Product } from '@/lib/api'

interface UseProductSearchOptions {
  products: Product[]
  searchTerm: string
  brand?: string
  machineModel?: string
  material?: string
}

export function useProductSearch({
  products,
  searchTerm,
  brand,
  machineModel,
  material,
}: UseProductSearchOptions) {
  const [results, setResults] = useState<Product[]>(products)

  // Fuse.js configuration
  const fuse = useMemo(() => {
    return new Fuse(products, {
      keys: [
        { name: 'partNumber', weight: 2 },
        { name: 'name', weight: 1.5 },
        { name: 'size', weight: 1 },
        { name: 'remark', weight: 0.5 },
      ],
      threshold: 0.3,
      includeScore: true,
      minMatchCharLength: 2,
    })
  }, [products])

  useEffect(() => {
    let filtered = products

    // Apply fuzzy search first
    if (searchTerm.trim()) {
      const searchResults = fuse.search(searchTerm)
      filtered = searchResults.map((result) => result.item)
    }

    // Apply brand filter
    if (brand) {
      filtered = filtered.filter((p) => p.brand === brand)
    }

    // Apply machine model filter
    if (machineModel) {
      filtered = filtered.filter((p) => p.machineModel === machineModel)
    }

    // Apply material filter
    if (material) {
      filtered = filtered.filter((p) => p.material === material)
    }

    setResults(filtered)
  }, [products, searchTerm, brand, machineModel, material, fuse])

  return {
    results,
    count: results.length,
  }
}
