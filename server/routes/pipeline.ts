import { Hono } from 'hono'
import { db } from '../db/index.js'
import { pipeline, customers } from '../db/schema.js'
import { eq, like, and, or, desc, sql } from 'drizzle-orm'

const app = new Hono()

// Get pipeline stats
app.get('/stats', async (c) => {
  try {
    const stats = await db
      .select({
        stage: pipeline.stage,
        count: sql<number>`count(*)`,
        totalValue: sql<number>`sum(${pipeline.dealValue})`,
        weightedValue: sql<number>`sum(${pipeline.dealValue} * ${pipeline.probability} / 100.0)`,
      })
      .from(pipeline)
      .groupBy(pipeline.stage)

    const totalWeighted = stats.reduce((sum, s) => sum + (s.weightedValue || 0), 0)

    return c.json({ data: stats, totalWeighted })
  } catch (error) {
    console.error('Error fetching pipeline stats:', error)
    return c.json({ error: 'Failed to fetch pipeline stats' }, 500)
  }
})

// List pipeline deals
app.get('/', async (c) => {
  const search = c.req.query('search') || ''
  const stage = c.req.query('stage') || ''
  const customerId = c.req.query('customerId') || ''
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '100')
  const offset = (page - 1) * limit

  try {
    const conditions = []

    if (search) {
      conditions.push(
        or(like(pipeline.title, `%${search}%`), like(pipeline.notes, `%${search}%`))
      )
    }

    if (stage) conditions.push(eq(pipeline.stage, stage))
    if (customerId) conditions.push(eq(pipeline.customerId, parseInt(customerId)))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const data = await db
      .select({
        id: pipeline.id,
        customerId: pipeline.customerId,
        customerName: customers.companyName,
        title: pipeline.title,
        stage: pipeline.stage,
        dealValue: pipeline.dealValue,
        currency: pipeline.currency,
        probability: pipeline.probability,
        expectedCloseDate: pipeline.expectedCloseDate,
        actualCloseDate: pipeline.actualCloseDate,
        lostReason: pipeline.lostReason,
        quotationId: pipeline.quotationId,
        assignedTo: pipeline.assignedTo,
        notes: pipeline.notes,
        tags: pipeline.tags,
        createdAt: pipeline.createdAt,
        updatedAt: pipeline.updatedAt,
      })
      .from(pipeline)
      .leftJoin(customers, eq(pipeline.customerId, customers.id))
      .where(whereClause)
      .orderBy(desc(pipeline.createdAt))
      .limit(limit)
      .offset(offset)

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(pipeline)
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
    console.error('Error fetching pipeline deals:', error)
    return c.json({ error: 'Failed to fetch pipeline deals' }, 500)
  }
})

// Get single deal
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const [deal] = await db
      .select({
        id: pipeline.id,
        customerId: pipeline.customerId,
        customerName: customers.companyName,
        title: pipeline.title,
        stage: pipeline.stage,
        dealValue: pipeline.dealValue,
        currency: pipeline.currency,
        probability: pipeline.probability,
        expectedCloseDate: pipeline.expectedCloseDate,
        actualCloseDate: pipeline.actualCloseDate,
        lostReason: pipeline.lostReason,
        quotationId: pipeline.quotationId,
        assignedTo: pipeline.assignedTo,
        notes: pipeline.notes,
        tags: pipeline.tags,
        createdAt: pipeline.createdAt,
        updatedAt: pipeline.updatedAt,
      })
      .from(pipeline)
      .leftJoin(customers, eq(pipeline.customerId, customers.id))
      .where(eq(pipeline.id, id))
      .limit(1)

    if (!deal) {
      return c.json({ error: 'Deal not found' }, 404)
    }

    return c.json({ data: deal })
  } catch (error) {
    console.error('Error fetching deal:', error)
    return c.json({ error: 'Failed to fetch deal' }, 500)
  }
})

// Create deal
app.post('/', async (c) => {
  try {
    const body = await c.req.json()

    if (typeof body.tags === 'object') {
      body.tags = JSON.stringify(body.tags)
    }

    const [newDeal] = await db.insert(pipeline).values(body).returning()

    return c.json({ data: newDeal }, 201)
  } catch (error) {
    console.error('Error creating deal:', error)
    return c.json({ error: 'Failed to create deal' }, 500)
  }
})

// Update deal
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const body = await c.req.json()

    if (typeof body.tags === 'object') {
      body.tags = JSON.stringify(body.tags)
    }

    body.updatedAt = new Date().toISOString()

    const [updated] = await db
      .update(pipeline)
      .set(body)
      .where(eq(pipeline.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Deal not found' }, 404)
    }

    return c.json({ data: updated })
  } catch (error) {
    console.error('Error updating deal:', error)
    return c.json({ error: 'Failed to update deal' }, 500)
  }
})

// Update deal stage
app.put('/:id/stage', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const { stage, lostReason } = await c.req.json()

    const updateData: any = {
      stage,
      updatedAt: new Date().toISOString(),
    }

    if (stage === 'won' || stage === 'lost') {
      updateData.actualCloseDate = new Date().toISOString()
    }

    if (stage === 'lost' && lostReason) {
      updateData.lostReason = lostReason
    }

    const [updated] = await db
      .update(pipeline)
      .set(updateData)
      .where(eq(pipeline.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Deal not found' }, 404)
    }

    return c.json({ data: updated })
  } catch (error) {
    console.error('Error updating deal stage:', error)
    return c.json({ error: 'Failed to update deal stage' }, 500)
  }
})

// Delete deal
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const [deleted] = await db.delete(pipeline).where(eq(pipeline.id, id)).returning()

    if (!deleted) {
      return c.json({ error: 'Deal not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Error deleting deal:', error)
    return c.json({ error: 'Failed to delete deal' }, 500)
  }
})

export default app
