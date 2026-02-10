import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import productsRouter from './routes/products'
import categoriesRouter from './routes/categories'
import customersRouter from './routes/customers'
import suppliersRouter from './routes/suppliers'
import activitiesRouter from './routes/activities'
import quotationsRouter from './routes/quotations'
import ordersRouter from './routes/orders'
import pipelineRouter from './routes/pipeline'
import dashboardRouter from './routes/dashboard'
import settingsRouter from './routes/settings'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use('*', cors())

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Routes
app.route('/api/products', productsRouter)
app.route('/api/categories', categoriesRouter)
app.route('/api/customers', customersRouter)
app.route('/api/suppliers', suppliersRouter)
app.route('/api/activities', activitiesRouter)
app.route('/api/quotations', quotationsRouter)
app.route('/api/orders', ordersRouter)
app.route('/api/pipeline', pipelineRouter)
app.route('/api/dashboard', dashboardRouter)
app.route('/api/settings', settingsRouter)

// 404
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404)
})

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err)
  return c.json({ error: err.message }, 500)
})

const port = 3001
console.log(`🚀 Server running on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port,
})
