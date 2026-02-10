import { Hono } from 'hono'
import { db } from '../db/index.js'
import { customers } from '../db/schema.js'
import { eq, like, and, or, desc, sql } from 'drizzle-orm'

const app = new Hono()

// List customers with filters
app.get('/', async (c) => {
  const search = c.req.query('search') || ''
  const type = c.req.query('type') || ''
  const province = c.req.query('province') || ''
  const tier = c.req.query('tier') || ''
  const status = c.req.query('status') || ''
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '20')
  const offset = (page - 1) * limit

  try {
    const conditions = []

    if (search) {
      conditions.push(
        or(
          like(customers.companyName, `%${search}%`),
          like(customers.companyNameLocal, `%${search}%`),
          like(customers.contactName, `%${search}%`),
          like(customers.contactPhone, `%${search}%`)
        )
      )
    }

    if (type) conditions.push(eq(customers.type, type))
    if (province) conditions.push(eq(customers.province, province))
    if (tier) conditions.push(eq(customers.tier, tier))
    if (status) conditions.push(eq(customers.status, status))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [data, [{ count }]] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(whereClause)
        .orderBy(desc(customers.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(customers)
        .where(whereClause),
    ])

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
    console.error('Error fetching customers:', error)
    return c.json({ error: 'Failed to fetch customers' }, 500)
  }
})

// Get single customer
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1)

    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404)
    }

    return c.json({ data: customer })
  } catch (error) {
    console.error('Error fetching customer:', error)
    return c.json({ error: 'Failed to fetch customer' }, 500)
  }
})

// Create customer
app.post('/', async (c) => {
  try {
    const body = await c.req.json()

    // Parse JSON fields
    if (typeof body.smtBrands === 'object') {
      body.smtBrands = JSON.stringify(body.smtBrands)
    }
    if (typeof body.smtModels === 'object') {
      body.smtModels = JSON.stringify(body.smtModels)
    }
    if (typeof body.tags === 'object') {
      body.tags = JSON.stringify(body.tags)
    }

    const [newCustomer] = await db.insert(customers).values(body).returning()

    return c.json({ data: newCustomer }, 201)
  } catch (error) {
    console.error('Error creating customer:', error)
    return c.json({ error: 'Failed to create customer' }, 500)
  }
})

// Update customer
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const body = await c.req.json()

    // Parse JSON fields
    if (typeof body.smtBrands === 'object') {
      body.smtBrands = JSON.stringify(body.smtBrands)
    }
    if (typeof body.smtModels === 'object') {
      body.smtModels = JSON.stringify(body.smtModels)
    }
    if (typeof body.tags === 'object') {
      body.tags = JSON.stringify(body.tags)
    }

    body.updatedAt = new Date().toISOString()

    const [updated] = await db
      .update(customers)
      .set(body)
      .where(eq(customers.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Customer not found' }, 404)
    }

    return c.json({ data: updated })
  } catch (error) {
    console.error('Error updating customer:', error)
    return c.json({ error: 'Failed to update customer' }, 500)
  }
})

// Delete customer
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const [deleted] = await db
      .delete(customers)
      .where(eq(customers.id, id))
      .returning()

    if (!deleted) {
      return c.json({ error: 'Customer not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Error deleting customer:', error)
    return c.json({ error: 'Failed to delete customer' }, 500)
  }
})

// Get customer types for filters
app.get('/filters/types', async (c) => {
  return c.json({
    data: [
      { value: 'fdi_japan', label: 'FDI-Japan' },
      { value: 'fdi_korea', label: 'FDI-Korea' },
      { value: 'fdi_china', label: 'FDI-China' },
      { value: 'fdi_taiwan', label: 'FDI-Taiwan' },
      { value: 'fdi_other', label: 'FDI-Other' },
      { value: 'domestic', label: 'Domestic' },
    ],
  })
})

// Get provinces
app.get('/filters/provinces', async (c) => {
  try {
    const provinces = await db
      .selectDistinct({ province: customers.province })
      .from(customers)
      .where(sql`${customers.province} IS NOT NULL AND ${customers.province} != ''`)

    return c.json({
      data: provinces.map((p) => p.province).filter(Boolean),
    })
  } catch (error) {
    console.error('Error fetching provinces:', error)
    return c.json({ error: 'Failed to fetch provinces' }, 500)
  }
})

export default app
