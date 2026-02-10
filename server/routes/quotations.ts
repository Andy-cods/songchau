import { Hono } from 'hono'
import { db } from '../db/index.js'
import { quotations, quoteItems, customers, products } from '../db/schema.js'
import { eq, like, and, or, desc, sql, gte, lte } from 'drizzle-orm'

const app = new Hono()

// Generate next quote number
app.get('/next-number', async (c) => {
  try {
    const year = new Date().getFullYear()
    const prefix = `SC-Q-${year}-`

    // Get the latest quote number for this year
    const [latest] = await db
      .select({ quoteNumber: quotations.quoteNumber })
      .from(quotations)
      .where(like(quotations.quoteNumber, `${prefix}%`))
      .orderBy(desc(quotations.quoteNumber))
      .limit(1)

    let nextNumber = 1
    if (latest) {
      const currentNumber = parseInt(latest.quoteNumber.split('-').pop() || '0')
      nextNumber = currentNumber + 1
    }

    const quoteNumber = `${prefix}${String(nextNumber).padStart(4, '0')}`
    return c.json({ quoteNumber })
  } catch (error) {
    console.error('Error generating quote number:', error)
    return c.json({ error: 'Failed to generate quote number' }, 500)
  }
})

// List quotations with filters
app.get('/', async (c) => {
  const search = c.req.query('search') || ''
  const status = c.req.query('status') || ''
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
          like(quotations.quoteNumber, `%${search}%`),
          like(quotations.notes, `%${search}%`)
        )
      )
    }

    if (status) conditions.push(eq(quotations.status, status))
    if (customerId) conditions.push(eq(quotations.customerId, parseInt(customerId)))
    if (dateFrom) conditions.push(gte(quotations.createdAt, dateFrom))
    if (dateTo) conditions.push(lte(quotations.createdAt, dateTo))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Fetch quotations with customer info
    const data = await db
      .select({
        id: quotations.id,
        quoteNumber: quotations.quoteNumber,
        customerId: quotations.customerId,
        customerName: customers.companyName,
        status: quotations.status,
        subtotal: quotations.subtotal,
        taxRate: quotations.taxRate,
        taxAmount: quotations.taxAmount,
        totalAmount: quotations.totalAmount,
        currency: quotations.currency,
        validUntil: quotations.validUntil,
        notes: quotations.notes,
        internalNotes: quotations.internalNotes,
        sentAt: quotations.sentAt,
        acceptedAt: quotations.acceptedAt,
        createdAt: quotations.createdAt,
        updatedAt: quotations.updatedAt,
      })
      .from(quotations)
      .leftJoin(customers, eq(quotations.customerId, customers.id))
      .where(whereClause)
      .orderBy(desc(quotations.createdAt))
      .limit(limit)
      .offset(offset)

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(quotations)
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
    console.error('Error fetching quotations:', error)
    return c.json({ error: 'Failed to fetch quotations' }, 500)
  }
})

// Get single quotation with items
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const [quotation] = await db
      .select({
        id: quotations.id,
        quoteNumber: quotations.quoteNumber,
        customerId: quotations.customerId,
        customerName: customers.companyName,
        customerContact: customers.contactName,
        customerPhone: customers.contactPhone,
        customerEmail: customers.contactEmail,
        customerAddress: customers.address,
        status: quotations.status,
        subtotal: quotations.subtotal,
        taxRate: quotations.taxRate,
        taxAmount: quotations.taxAmount,
        totalAmount: quotations.totalAmount,
        currency: quotations.currency,
        validUntil: quotations.validUntil,
        notes: quotations.notes,
        internalNotes: quotations.internalNotes,
        sentAt: quotations.sentAt,
        acceptedAt: quotations.acceptedAt,
        createdAt: quotations.createdAt,
        updatedAt: quotations.updatedAt,
      })
      .from(quotations)
      .leftJoin(customers, eq(quotations.customerId, customers.id))
      .where(eq(quotations.id, id))
      .limit(1)

    if (!quotation) {
      return c.json({ error: 'Quotation not found' }, 404)
    }

    // Fetch items
    const items = await db
      .select({
        id: quoteItems.id,
        quotationId: quoteItems.quotationId,
        productId: quoteItems.productId,
        productPartNumber: products.partNumber,
        productName: products.name,
        supplierId: quoteItems.supplierId,
        quantity: quoteItems.quantity,
        unitPrice: quoteItems.unitPrice,
        costPrice: quoteItems.costPrice,
        amount: quoteItems.amount,
        notes: quoteItems.notes,
      })
      .from(quoteItems)
      .leftJoin(products, eq(quoteItems.productId, products.id))
      .where(eq(quoteItems.quotationId, id))

    return c.json({ data: { ...quotation, items } })
  } catch (error) {
    console.error('Error fetching quotation:', error)
    return c.json({ error: 'Failed to fetch quotation' }, 500)
  }
})

// Create quotation
app.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const { items, ...quotationData } = body

    // Create quotation
    const [newQuotation] = await db
      .insert(quotations)
      .values(quotationData)
      .returning()

    // Create items
    if (items && items.length > 0) {
      const itemsToInsert = items.map((item: any) => ({
        ...item,
        quotationId: newQuotation.id,
      }))
      await db.insert(quoteItems).values(itemsToInsert)
    }

    return c.json({ data: newQuotation }, 201)
  } catch (error) {
    console.error('Error creating quotation:', error)
    return c.json({ error: 'Failed to create quotation' }, 500)
  }
})

// Update quotation
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const body = await c.req.json()
    const { items, ...quotationData } = body

    quotationData.updatedAt = new Date().toISOString()

    // Update quotation
    const [updated] = await db
      .update(quotations)
      .set(quotationData)
      .where(eq(quotations.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Quotation not found' }, 404)
    }

    // Update items - delete old and insert new
    if (items) {
      await db.delete(quoteItems).where(eq(quoteItems.quotationId, id))

      if (items.length > 0) {
        const itemsToInsert = items.map((item: any) => ({
          ...item,
          quotationId: id,
        }))
        await db.insert(quoteItems).values(itemsToInsert)
      }
    }

    return c.json({ data: updated })
  } catch (error) {
    console.error('Error updating quotation:', error)
    return c.json({ error: 'Failed to update quotation' }, 500)
  }
})

// Update quotation status
app.put('/:id/status', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const { status } = await c.req.json()

    const updateData: any = {
      status,
      updatedAt: new Date().toISOString(),
    }

    // Set timestamps based on status
    if (status === 'sent' && !updateData.sentAt) {
      updateData.sentAt = new Date().toISOString()
    } else if (status === 'accepted' && !updateData.acceptedAt) {
      updateData.acceptedAt = new Date().toISOString()
    }

    const [updated] = await db
      .update(quotations)
      .set(updateData)
      .where(eq(quotations.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Quotation not found' }, 404)
    }

    return c.json({ data: updated })
  } catch (error) {
    console.error('Error updating quotation status:', error)
    return c.json({ error: 'Failed to update quotation status' }, 500)
  }
})

// Delete quotation
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    // Delete items first
    await db.delete(quoteItems).where(eq(quoteItems.quotationId, id))

    // Delete quotation
    const [deleted] = await db
      .delete(quotations)
      .where(eq(quotations.id, id))
      .returning()

    if (!deleted) {
      return c.json({ error: 'Quotation not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Error deleting quotation:', error)
    return c.json({ error: 'Failed to delete quotation' }, 500)
  }
})

export default app
