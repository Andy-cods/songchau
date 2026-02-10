import { useParams } from 'react-router-dom'
import OrderForm from '@/components/orders/OrderForm'

export default function OrderEdit() {
  const { id } = useParams<{ id: string }>()
  return <OrderForm orderId={id ? parseInt(id) : undefined} />
}
