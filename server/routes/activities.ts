import { Hono } from 'hono'
import { db } from '../db/index.js'
import { activities } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const app = new Hono()

// Get activities for an entity
app.get('/', async (c) => {
  const entityType = c.req.query('entityType') || ''
  const entityId = c.req.query('entityId') || ''
  const limit = parseInt(c.req.query('limit') || '50')

  if (!entityType || !entityId) {
    return c.json({ error: 'entityType and entityId are required' }, 400)
  }

  try {
    const data = await db
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.entityType, entityType),
          eq(activities.entityId, parseInt(entityId))
        )
      )
      .orderBy(desc(activities.createdAt))
      .limit(limit)

    return c.json({ data })
  } catch (error) {
    console.error('Error fetching activities:', error)
    return c.json({ error: 'Failed to fetch activities' }, 500)
  }
})

// Get single activity
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const [activity] = await db
      .select()
      .from(activities)
      .where(eq(activities.id, id))
      .limit(1)

    if (!activity) {
      return c.json({ error: 'Activity not found' }, 404)
    }

    return c.json({ data: activity })
  } catch (error) {
    console.error('Error fetching activity:', error)
    return c.json({ error: 'Failed to fetch activity' }, 500)
  }
})

// Create activity
app.post('/', async (c) => {
  try {
    const body = await c.req.json()

    if (!body.entityType || !body.entityId || !body.type) {
      return c.json(
        { error: 'entityType, entityId, and type are required' },
        400
      )
    }

    const [newActivity] = await db.insert(activities).values(body).returning()

    return c.json({ data: newActivity }, 201)
  } catch (error) {
    console.error('Error creating activity:', error)
    return c.json({ error: 'Failed to create activity' }, 500)
  }
})

// Update activity
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const body = await c.req.json()

    const [updated] = await db
      .update(activities)
      .set(body)
      .where(eq(activities.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Activity not found' }, 404)
    }

    return c.json({ data: updated })
  } catch (error) {
    console.error('Error updating activity:', error)
    return c.json({ error: 'Failed to update activity' }, 500)
  }
})

// Delete activity
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const [deleted] = await db
      .delete(activities)
      .where(eq(activities.id, id))
      .returning()

    if (!deleted) {
      return c.json({ error: 'Activity not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Error deleting activity:', error)
    return c.json({ error: 'Failed to delete activity' }, 500)
  }
})

// Mark follow-up as done
app.patch('/:id/follow-up-done', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const [updated] = await db
      .update(activities)
      .set({ followUpDone: true })
      .where(eq(activities.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Activity not found' }, 404)
    }

    return c.json({ data: updated })
  } catch (error) {
    console.error('Error updating activity:', error)
    return c.json({ error: 'Failed to update activity' }, 500)
  }
})

export default app
