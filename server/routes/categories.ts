import { Hono } from 'hono'
import { db, schema } from '../db/index'
import { asc } from 'drizzle-orm'

const app = new Hono()

// GET /api/categories - Get all categories
app.get('/', async (c) => {
  try {
    const categories = await db
      .select()
      .from(schema.productCategories)
      .orderBy(asc(schema.productCategories.sortOrder))

    return c.json({ data: categories })
  } catch (error) {
    console.error('Error fetching categories:', error)
    return c.json({ error: 'Failed to fetch categories' }, 500)
  }
})

export default app
