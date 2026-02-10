import { useQuery } from '@tanstack/react-query'

const API_BASE = '/api'

interface CustomerOption {
  id: number
  companyName: string
  contact: string | null
  phone: string | null
  email: string | null
  address: string | null
}

export function useCustomerList() {
  return useQuery({
    queryKey: ['customers', 'list-all'],
    queryFn: async (): Promise<CustomerOption[]> => {
      const res = await fetch(`${API_BASE}/customers?limit=500`)
      if (!res.ok) throw new Error('Failed to fetch customers')
      const json = await res.json()
      return json.data.map((c: any) => ({
        id: c.id,
        companyName: c.companyName,
        contact: c.contact,
        phone: c.phone,
        email: c.email,
        address: c.address,
      }))
    },
    staleTime: 5 * 60 * 1000,
  })
}
