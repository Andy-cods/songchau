import { Hono } from 'hono'
import { db } from '../db/index.js'
import { orders, orderItems, orderDocuments, customers, products } from '../db/schema.js'
import { eq, like, and, or, desc, sql, gte, lte } from 'drizzle-orm'

const app = new Hono()

// List orders with filters
app.get('/', async (c) => {
  const search = c.req.query('search') || ''
  const status = c.req.query('status') || ''
  const paymentStatus = c.req.query('paymentStatus') || ''
  const customerId = c.req.query('customerId') || ''
  const dateFrom = c.req.query('dateFrom') || ''
  const dateTo = c.req.query('dateTo') || ''
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '20')
  const offset = (page - 1) * limit

  try {
    const conditions = []

    if (search) {
      conditions.push(
        or(
          like(orders.orderNumber, `%${search}%`),
          like(orders.poNumber, `%${search}%`)
        )
      )
    }

    if (status) conditions.push(eq(orders.status, status))
    if (paymentStatus) conditions.push(eq(orders.paymentStatus, paymentStatus))
    if (customerId) conditions.push(eq(orders.customerId, parseInt(customerId)))
    if (dateFrom) conditions.push(gte(orders.createdAt, dateFrom))
    if (dateTo) conditions.push(lte(orders.createdAt, dateTo))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const data = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        quotationId: orders.quotationId,
        customerId: orders.customerId,
        customerName: customers.companyName,
        status: orders.status,
        poNumber: orders.poNumber,
        totalAmount: orders.totalAmount,
        currency: orders.currency,
        paymentStatus: orders.paymentStatus,
        paidAmount: orders.paidAmount,
        paymentDueDate: orders.paymentDueDate,
        expectedDelivery: orders.expectedDelivery,
        actualDelivery: orders.actualDelivery,
        trackingNumber: orders.trackingNumber,
        notes: orders.notes,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(whereClause)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset)

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(whereClause)

    return c.json({
      data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching orders:', error)
    return c.json({ error: 'Failed to fetch orders' }, 500)
  }
})

// Get single order with items
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const [order] = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        quotationId: orders.quotationId,
        customerId: orders.customerId,
        customerName: customers.companyName,
        customerContact: customers.contactName,
        customerPhone: customers.contactPhone,
        customerEmail: customers.contactEmail,
        customerAddress: customers.address,
        status: orders.status,
        poNumber: orders.poNumber,
        totalAmount: orders.totalAmount,
        currency: orders.currency,
        paymentStatus: orders.paymentStatus,
        paidAmount: orders.paidAmount,
        paymentDueDate: orders.paymentDueDate,
        expectedDelivery: orders.expectedDelivery,
        actualDelivery: orders.actualDelivery,
        deliveryAddress: orders.deliveryAddress,
        trackingNumber: orders.trackingNumber,
        notes: orders.notes,
        internalNotes: orders.internalNotes,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(eq(orders.id, id))
      .limit(1)

    if (!order) {
      return c.json({ error: 'Order not found' }, 404)
    }

    // Fetch items
    const items = await db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        productId: orderItems.productId,
        productPartNumber: products.partNumber,
        productName: products.name,
        supplierId: orderItems.supplierId,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        costPrice: orderItems.costPrice,
        amount: orderItems.amount,
        status: orderItems.status,
        supplierOrderDate: orderItems.supplierOrderDate,
        supplierDeliveryDate: orderItems.supplierDeliveryDate,
      })
      .from(orderItems)
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, id))

    return c.json({ data: { ...order, items } })
  } catch (error) {
    console.error('Error fetching order:', error)
    return c.json({ error: 'Failed to fetch order' }, 500)
  }
})

// Create order
app.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const { items, ...orderData } = body

    // Auto-generate orderNumber if not provided
    if (!orderData.orderNumber) {
      const now = new Date()
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')

      const [latest] = await db
        .select({ orderNumber: orders.orderNumber })
        .from(orders)
        .where(like(orders.orderNumber, `SC-ORD-${year}${month}-%`))
        .orderBy(desc(orders.id))
        .limit(1)

      let seq = 1
      if (latest?.orderNumber) {
        const parts = latest.orderNumber.split('-')
        seq = parseInt(parts[parts.length - 1]) + 1
      }
      orderData.orderNumber = `SC-ORD-${year}${month}-${String(seq).padStart(4, '0')}`
    }

    const [newOrder] = await db.insert(orders).values(orderData).returning()

    if (items && items.length > 0) {
      const itemsToInsert = items.map((item: any) => ({
        ...item,
        orderId: newOrder.id,
      }))
      await db.insert(orderItems).values(itemsToInsert)
    }

    return c.json({ data: newOrder }, 201)
  } catch (error) {
    console.error('Error creating order:', error)
    return c.json({ error: 'Failed to create order' }, 500)
  }
})

// Update order
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const body = await c.req.json()
    const { items, ...orderData } = body

    orderData.updatedAt = new Date().toISOString()

    const [updated] = await db
      .update(orders)
      .set(orderData)
      .where(eq(orders.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Order not found' }, 404)
    }

    if (items) {
      await db.delete(orderItems).where(eq(orderItems.orderId, id))

      if (items.length > 0) {
        const itemsToInsert = items.map((item: any) => ({
          ...item,
          orderId: id,
        }))
        await db.insert(orderItems).values(itemsToInsert)
      }
    }

    return c.json({ data: updated })
  } catch (error) {
    console.error('Error updating order:', error)
    return c.json({ error: 'Failed to update order' }, 500)
  }
})

// Update order status
app.put('/:id/status', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const { status } = await c.req.json()

    const [updated] = await db
      .update(orders)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(orders.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Order not found' }, 404)
    }

    return c.json({ data: updated })
  } catch (error) {
    console.error('Error updating order status:', error)
    return c.json({ error: 'Failed to update order status' }, 500)
  }
})

// Record payment
app.post('/:id/payments', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const { amount } = await c.req.json()

    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1)

    if (!order) {
      return c.json({ error: 'Order not found' }, 404)
    }

    const newPaidAmount = (order.paidAmount || 0) + amount
    const totalAmount = order.totalAmount || 0

    let paymentStatus = 'unpaid'
    if (newPaidAmount >= totalAmount) {
      paymentStatus = 'paid'
    } else if (newPaidAmount > 0) {
      paymentStatus = 'partial'
    }

    const [updated] = await db
      .update(orders)
      .set({
        paidAmount: newPaidAmount,
        paymentStatus,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(orders.id, id))
      .returning()

    return c.json({ data: updated })
  } catch (error) {
    console.error('Error recording payment:', error)
    return c.json({ error: 'Failed to record payment' }, 500)
  }
})

// ==================== DOCUMENTS ====================

// Get documents for an order
app.get('/:id/documents', async (c) => {
  const orderId = parseInt(c.req.param('id'))
  try {
    const docs = await db
      .select()
      .from(orderDocuments)
      .where(eq(orderDocuments.orderId, orderId))
      .orderBy(desc(orderDocuments.createdAt))

    return c.json({ data: docs })
  } catch (error) {
    console.error('Error fetching documents:', error)
    return c.json({ error: 'Failed to fetch documents' }, 500)
  }
})

// Add document to order
app.post('/:id/documents', async (c) => {
  const orderId = parseInt(c.req.param('id'))
  try {
    const body = await c.req.json()
    const [doc] = await db.insert(orderDocuments).values({
      orderId,
      title: body.title,
      url: body.url,
      type: body.type || 'other',
      notes: body.notes || null,
    }).returning()

    return c.json({ data: doc }, 201)
  } catch (error) {
    console.error('Error creating document:', error)
    return c.json({ error: 'Failed to create document' }, 500)
  }
})

// Delete document
app.delete('/:id/documents/:docId', async (c) => {
  const docId = parseInt(c.req.param('docId'))
  try {
    const [deleted] = await db.delete(orderDocuments).where(eq(orderDocuments.id, docId)).returning()
    if (!deleted) {
      return c.json({ error: 'Document not found' }, 404)
    }
    return c.json({ success: true })
  } catch (error) {
    console.error('Error deleting document:', error)
    return c.json({ error: 'Failed to delete document' }, 500)
  }
})

// Delete order
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    await db.delete(orderItems).where(eq(orderItems.orderId, id))
    const [deleted] = await db.delete(orders).where(eq(orders.id, id)).returning()

    if (!deleted) {
      return c.json({ error: 'Order not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Error deleting order:', error)
    return c.json({ error: 'Failed to delete order' }, 500)
  }
})

export default app
