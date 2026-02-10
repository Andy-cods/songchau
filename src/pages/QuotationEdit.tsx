import { useParams } from 'react-router-dom'
import QuotationForm from '@/components/quotations/QuotationForm'

export default function QuotationEditPage() {
  const { id } = useParams<{ id: string }>()
  return <QuotationForm quotationId={id ? parseInt(id) : undefined} />
}
