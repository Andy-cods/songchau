import { Hono } from 'hono'
import { db } from '../db/index.js'
import { suppliers } from '../db/schema.js'
import { eq, like, and, or, desc, sql } from 'drizzle-orm'

const app = new Hono()

// List suppliers with filters
app.get('/', async (c) => {
  const search = c.req.query('search') || ''
  const country = c.req.query('country') || ''
  const platform = c.req.query('platform') || ''
  const status = c.req.query('status') || ''
  const minRating = c.req.query('minRating') || ''
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '20')
  const offset = (page - 1) * limit

  try {
    const conditions = []

    if (search) {
      conditions.push(
        or(
          like(suppliers.companyName, `%${search}%`),
          like(suppliers.companyNameLocal, `%${search}%`),
          like(suppliers.contactName, `%${search}%`)
        )
      )
    }

    if (country) conditions.push(eq(suppliers.country, country))
    if (platform) conditions.push(eq(suppliers.platform, platform))
    if (status) conditions.push(eq(suppliers.status, status))
    if (minRating) {
      conditions.push(sql`${suppliers.rating} >= ${parseInt(minRating)}`)
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [data, [{ count }]] = await Promise.all([
      db
        .select()
        .from(suppliers)
        .where(whereClause)
        .orderBy(desc(suppliers.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(suppliers)
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
    console.error('Error fetching suppliers:', error)
    return c.json({ error: 'Failed to fetch suppliers' }, 500)
  }
})

// Get single supplier
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, id))
      .limit(1)

    if (!supplier) {
      return c.json({ error: 'Supplier not found' }, 404)
    }

    return c.json({ data: supplier })
  } catch (error) {
    console.error('Error fetching supplier:', error)
    return c.json({ error: 'Failed to fetch supplier' }, 500)
  }
})

// Create supplier
app.post('/', async (c) => {
  try {
    const body = await c.req.json()

    // Parse JSON fields
    if (typeof body.speciality === 'object') {
      body.speciality = JSON.stringify(body.speciality)
    }
    if (typeof body.brands === 'object') {
      body.brands = JSON.stringify(body.brands)
    }
    if (typeof body.paymentMethods === 'object') {
      body.paymentMethods = JSON.stringify(body.paymentMethods)
    }
    if (typeof body.tags === 'object') {
      body.tags = JSON.stringify(body.tags)
    }

    const [newSupplier] = await db.insert(suppliers).values(body).returning()

    return c.json({ data: newSupplier }, 201)
  } catch (error) {
    console.error('Error creating supplier:', error)
    return c.json({ error: 'Failed to create supplier' }, 500)
  }
})

// Update supplier
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const body = await c.req.json()

    // Parse JSON fields
    if (typeof body.speciality === 'object') {
      body.speciality = JSON.stringify(body.speciality)
    }
    if (typeof body.brands === 'object') {
      body.brands = JSON.stringify(body.brands)
    }
    if (typeof body.paymentMethods === 'object') {
      body.paymentMethods = JSON.stringify(body.paymentMethods)
    }
    if (typeof body.tags === 'object') {
      body.tags = JSON.stringify(body.tags)
    }

    body.updatedAt = new Date().toISOString()

    const [updated] = await db
      .update(suppliers)
      .set(body)
      .where(eq(suppliers.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Supplier not found' }, 404)
    }

    return c.json({ data: updated })
  } catch (error) {
    console.error('Error updating supplier:', error)
    return c.json({ error: 'Failed to update supplier' }, 500)
  }
})

// Delete supplier
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const [deleted] = await db
      .delete(suppliers)
      .where(eq(suppliers.id, id))
      .returning()

    if (!deleted) {
      return c.json({ error: 'Supplier not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Error deleting supplier:', error)
    return c.json({ error: 'Failed to delete supplier' }, 500)
  }
})

// Get countries for filters
app.get('/filters/countries', async (c) => {
  return c.json({
    data: [
      { value: 'china', label: '🇨🇳 China' },
      { value: 'japan', label: '🇯🇵 Japan' },
      { value: 'taiwan', label: '🇹🇼 Taiwan' },
      { value: 'korea', label: '🇰🇷 Korea' },
      { value: 'vietnam', label: '🇻🇳 Vietnam' },
    ],
  })
})

export default app
