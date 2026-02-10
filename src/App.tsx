import { BrowserRouter, Routes, Route } from 'react-router-dom'
import MainLayout from './components/layout/MainLayout'
import Dashboard from './pages/Dashboard'
import ProductLookup from './pages/ProductLookup'
import Products from './pages/Products'
import Customers from './pages/Customers'
import Suppliers from './pages/Suppliers'
import Quotations from './pages/Quotations'
import QuotationNew from './pages/QuotationNew'
import QuotationEditPage from './pages/QuotationEdit'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import OrderNew from './pages/OrderNew'
import OrderEdit from './pages/OrderEdit'
import Pipeline from './pages/Pipeline'
import Settings from './pages/Settings'
import { Toaster } from './components/ui/toaster'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
        </Route>
        <Route path="/product-lookup" element={<MainLayout />}>
          <Route index element={<ProductLookup />} />
        </Route>
        <Route path="/products" element={<MainLayout />}>
          <Route index element={<Products />} />
        </Route>
        <Route path="/customers" element={<MainLayout />}>
          <Route index element={<Customers />} />
        </Route>
        <Route path="/suppliers" element={<MainLayout />}>
          <Route index element={<Suppliers />} />
        </Route>
        <Route path="/quotations" element={<MainLayout />}>
          <Route index element={<Quotations />} />
        </Route>
        <Route path="/quotations/new" element={<MainLayout />}>
          <Route index element={<QuotationNew />} />
        </Route>
        <Route path="/quotations/:id/edit" element={<MainLayout />}>
          <Route index element={<QuotationEditPage />} />
        </Route>
        <Route path="/orders" element={<MainLayout />}>
          <Route index element={<Orders />} />
        </Route>
        <Route path="/orders/new" element={<MainLayout />}>
          <Route index element={<OrderNew />} />
        </Route>
        <Route path="/orders/:id" element={<MainLayout />}>
          <Route index element={<OrderDetail />} />
        </Route>
        <Route path="/orders/:id/edit" element={<MainLayout />}>
          <Route index element={<OrderEdit />} />
        </Route>
        <Route path="/pipeline" element={<MainLayout />}>
          <Route index element={<Pipeline />} />
        </Route>
        <Route path="/settings" element={<MainLayout />}>
          <Route index element={<Settings />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
