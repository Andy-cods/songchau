import { Hono } from 'hono'
import { db } from '../db/index.js'
import { orders, quotations, activities, products, customers } from '../db/schema.js'
import { eq, desc, sql, gte } from 'drizzle-orm'

const app = new Hono()

// Get dashboard stats
app.get('/stats', async (c) => {
  try {
    const now = new Date()
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const currentMonthStr = currentMonth.toISOString()
    const lastMonthStr = lastMonth.toISOString()

    // Revenue this month
    const [currentMonthRevenue] = await db
      .select({ total: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)` })
      .from(orders)
      .where(gte(orders.createdAt, currentMonthStr))

    // Revenue last month
    const [lastMonthRevenue] = await db
      .select({ total: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)` })
      .from(orders)
      .where(sql`${orders.createdAt} >= ${lastMonthStr} AND ${orders.createdAt} < ${currentMonthStr}`)

    const revenueChange =
      lastMonthRevenue.total > 0
        ? ((currentMonthRevenue.total - lastMonthRevenue.total) / lastMonthRevenue.total) * 100
        : 0

    // Pending orders
    const [pendingOrders] = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(sql`${orders.status} IN ('confirmed', 'purchasing', 'in_transit', 'quality_check')`)

    // Quotations awaiting response
    const [pendingQuotations] = await db
      .select({ count: sql<number>`count(*)` })
      .from(quotations)
      .where(eq(quotations.status, 'sent'))

    // Pipeline weighted value
    const pipelineStats = await db
      .select({
        weightedValue: sql<number>`COALESCE(SUM(${sql`CAST(deal_value AS REAL)`} * ${sql`CAST(probability AS REAL)`} / 100.0), 0)`,
      })
      .from(sql`pipeline`)
      .where(sql`stage NOT IN ('won', 'lost')`)

    const pipelineValue = pipelineStats[0]?.weightedValue || 0

    return c.json({
      revenue: {
        current: currentMonthRevenue.total,
        change: revenueChange,
      },
      pendingOrders: pendingOrders.count,
      pendingQuotations: pendingQuotations.count,
      pipelineValue,
    })
  } catch (error) {
    console.error('Error fetching dashboard stats:', error)
    return c.json({ error: 'Failed to fetch dashboard stats' }, 500)
  }
})

// Get revenue by month (last 6 months)
app.get('/revenue-by-month', async (c) => {
  try {
    const now = new Date()
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    const revenueData = await db
      .select({
        month: sql<string>`strftime('%Y-%m', ${orders.createdAt})`,
        revenue: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
      })
      .from(orders)
      .where(gte(orders.createdAt, sixMonthsAgo.toISOString()))
      .groupBy(sql`strftime('%Y-%m', ${orders.createdAt})`)
      .orderBy(sql`strftime('%Y-%m', ${orders.createdAt})`)

    return c.json({ data: revenueData })
  } catch (error) {
    console.error('Error fetching revenue by month:', error)
    return c.json({ error: 'Failed to fetch revenue data' }, 500)
  }
})

// Get products by category
app.get('/products-by-category', async (c) => {
  try {
    const categoryData = await db
      .select({
        category: products.category,
        count: sql<number>`count(*)`,
      })
      .from(products)
      .groupBy(products.category)

    return c.json({ data: categoryData })
  } catch (error) {
    console.error('Error fetching products by category:', error)
    return c.json({ error: 'Failed to fetch category data' }, 500)
  }
})

// Get top 5 customers by revenue
app.get('/top-customers', async (c) => {
  try {
    const topCustomers = await db
      .select({
        customerId: orders.customerId,
        customerName: customers.companyName,
        totalOrders: sql<number>`count(*)`,
        revenue: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .groupBy(orders.customerId, customers.companyName)
      .orderBy(desc(sql`COALESCE(SUM(${orders.totalAmount}), 0)`))
      .limit(5)

    return c.json({ data: topCustomers })
  } catch (error) {
    console.error('Error fetching top customers:', error)
    return c.json({ error: 'Failed to fetch top customers' }, 500)
  }
})

// Get recent activities
app.get('/recent-activities', async (c) => {
  try {
    const recentActivities = await db
      .select()
      .from(activities)
      .orderBy(desc(activities.createdAt))
      .limit(10)

    return c.json({ data: recentActivities })
  } catch (error) {
    console.error('Error fetching recent activities:', error)
    return c.json({ error: 'Failed to fetch activities' }, 500)
  }
})

// Get follow-up reminders
app.get('/follow-up-reminders', async (c) => {
  try {
    const reminders = await db
      .select()
      .from(activities)
      .where(sql`${activities.followUpAt} IS NOT NULL AND ${activities.followUpDone} = 0`)
      .orderBy(activities.followUpAt)

    return c.json({ data: reminders })
  } catch (error) {
    console.error('Error fetching follow-up reminders:', error)
    return c.json({ error: 'Failed to fetch reminders' }, 500)
  }
})

export default app
