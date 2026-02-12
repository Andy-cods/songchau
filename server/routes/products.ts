import { Hono } from 'hono'
import { db, schema } from '../db/index'
import { eq, like, and, or, sql, desc, ne } from 'drizzle-orm'

const app = new Hono()

// GET /api/products - List all products with filters and pagination
app.get('/', async (c) => {
  const search = c.req.query('search') || ''
  const category = c.req.query('category') || ''
  const brand = c.req.query('brand') || ''
  const machineModel = c.req.query('machineModel') || ''
  const material = c.req.query('material') || ''
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = (page - 1) * limit

  try {
    // Build where conditions
    const conditions = []

    if (search) {
      conditions.push(
        or(
          like(schema.products.partNumber, `%${search}%`),
          like(schema.products.name, `%${search}%`),
          like(schema.products.brand, `%${search}%`),
          like(schema.products.machineModel, `%${search}%`)
        )
      )
    }

    if (category) {
      conditions.push(eq(schema.products.category, category))
    }

    if (brand) {
      conditions.push(eq(schema.products.brand, brand))
    }

    if (machineModel) {
      conditions.push(eq(schema.products.machineModel, machineModel))
    }

    if (material) {
      conditions.push(eq(schema.products.material, material))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Get products
    const products = await db
      .select()
      .from(schema.products)
      .where(whereClause)
      .orderBy(desc(schema.products.createdAt))
      .limit(limit)
      .offset(offset)

    // Get total count
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.products)
      .where(whereClause)

    const total = totalResult[0]?.count || 0

    return c.json({
      data: products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching products:', error)
    return c.json({ error: 'Failed to fetch products' }, 500)
  }
})

// GET /api/products/stats - Get product statistics
app.get('/stats', async (c) => {
  try {
    // Count by category
    const categoryStats = await db
      .select({
        category: schema.products.category,
        count: sql<number>`count(*)`,
      })
      .from(schema.products)
      .groupBy(schema.products.category)

    // Count by brand
    const brandStats = await db
      .select({
        brand: schema.products.brand,
        count: sql<number>`count(*)`,
      })
      .from(schema.products)
      .where(sql`${schema.products.brand} IS NOT NULL`)
      .groupBy(schema.products.brand)
      .orderBy(desc(sql`count(*)`))

    // Total count
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.products)

    const total = totalResult[0]?.count || 0

    return c.json({
      total,
      byCategory: categoryStats,
      byBrand: brandStats,
    })
  } catch (error) {
    console.error('Error fetching stats:', error)
    return c.json({ error: 'Failed to fetch stats' }, 500)
  }
})

// GET /api/products/brands - Get unique brands
app.get('/brands', async (c) => {
  try {
    const brands = await db
      .selectDistinct({ brand: schema.products.brand })
      .from(schema.products)
      .where(sql`${schema.products.brand} IS NOT NULL`)
      .orderBy(schema.products.brand)

    return c.json({
      data: brands.map(b => b.brand).filter(Boolean),
    })
  } catch (error) {
    console.error('Error fetching brands:', error)
    return c.json({ error: 'Failed to fetch brands' }, 500)
  }
})

// GET /api/products/models - Get unique machine models (optionally filtered by brand)
app.get('/models', async (c) => {
  const brand = c.req.query('brand') || ''

  try {
    const conditions = [sql`${schema.products.machineModel} IS NOT NULL`]
    if (brand) {
      conditions.push(eq(schema.products.brand, brand))
    }

    const models = await db
      .selectDistinct({ machineModel: schema.products.machineModel })
      .from(schema.products)
      .where(and(...conditions))
      .orderBy(schema.products.machineModel)

    return c.json({
      data: models.map(m => m.machineModel).filter(Boolean),
    })
  } catch (error) {
    console.error('Error fetching models:', error)
    return c.json({ error: 'Failed to fetch models' }, 500)
  }
})

// GET /api/products/:id/sales-history - Get sales history for a product
app.get('/:id/sales-history', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid product ID' }, 400)

  try {
    const orderHistory = await db
      .select({
        id: schema.orderItems.id,
        referenceNumber: schema.orders.orderNumber,
        customerName: schema.customers.companyName,
        date: schema.orders.createdAt,
        quantity: schema.orderItems.quantity,
        unitPrice: schema.orderItems.unitPrice,
        amount: schema.orderItems.amount,
        status: schema.orders.status,
      })
      .from(schema.orderItems)
      .leftJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
      .where(eq(schema.orderItems.productId, id))
      .orderBy(desc(schema.orders.createdAt))

    const quoteHistory = await db
      .select({
        id: schema.quoteItems.id,
        referenceNumber: schema.quotations.quoteNumber,
        customerName: schema.customers.companyName,
        date: schema.quotations.createdAt,
        quantity: schema.quoteItems.quantity,
        unitPrice: schema.quoteItems.unitPrice,
        amount: schema.quoteItems.amount,
        status: schema.quotations.status,
      })
      .from(schema.quoteItems)
      .leftJoin(schema.quotations, eq(schema.quoteItems.quotationId, schema.quotations.id))
      .leftJoin(schema.customers, eq(schema.quotations.customerId, schema.customers.id))
      .where(eq(schema.quoteItems.productId, id))
      .orderBy(desc(schema.quotations.createdAt))

    const totalSoldQty = orderHistory.reduce((sum, item) => sum + (item.quantity || 0), 0)
    const totalRevenue = orderHistory.reduce((sum, item) => sum + (item.amount || 0), 0)
    const uniqueCustomers = new Set(orderHistory.map(item => item.customerName).filter(Boolean)).size

    return c.json({
      data: {
        orders: orderHistory,
        quotations: quoteHistory,
        summary: {
          totalSoldQty,
          totalRevenue,
          uniqueCustomers,
          totalOrders: orderHistory.length,
          totalQuotations: quoteHistory.length,
        },
      },
    })
  } catch (error) {
    console.error('Error fetching sales history:', error)
    return c.json({ error: 'Failed to fetch sales history' }, 500)
  }
})

// GET /api/products/:id/suppliers - Get suppliers for a product
app.get('/:id/suppliers', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid product ID' }, 400)

  try {
    const supplierData = await db
      .select({
        id: schema.supplierProducts.id,
        supplierId: schema.supplierProducts.supplierId,
        supplierName: schema.suppliers.companyName,
        country: schema.suppliers.country,
        platform: schema.suppliers.platform,
        rating: schema.suppliers.rating,
        qualityScore: schema.suppliers.qualityScore,
        deliveryScore: schema.suppliers.deliveryScore,
        priceScore: schema.suppliers.priceScore,
        costPrice: schema.supplierProducts.costPrice,
        costCurrency: schema.supplierProducts.costCurrency,
        moq: schema.supplierProducts.moq,
        leadTimeDays: schema.supplierProducts.leadTimeDays,
        lastPurchaseDate: schema.supplierProducts.lastPurchaseDate,
        lastPurchasePrice: schema.supplierProducts.lastPurchasePrice,
        notes: schema.supplierProducts.notes,
      })
      .from(schema.supplierProducts)
      .leftJoin(schema.suppliers, eq(schema.supplierProducts.supplierId, schema.suppliers.id))
      .where(eq(schema.supplierProducts.productId, id))
      .orderBy(schema.supplierProducts.costPrice)

    const bestPriceSupplierId = supplierData.length > 0
      ? supplierData.reduce((best, curr) =>
          (curr.costPrice ?? Infinity) < (best.costPrice ?? Infinity) ? curr : best
        ).supplierId
      : null

    return c.json({
      data: {
        suppliers: supplierData,
        bestPriceSupplierId,
      },
    })
  } catch (error) {
    console.error('Error fetching product suppliers:', error)
    return c.json({ error: 'Failed to fetch product suppliers' }, 500)
  }
})

// GET /api/products/:id/related - Get related products (same machine model + brand)
app.get('/:id/related', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid product ID' }, 400)

  try {
    const [currentProduct] = await db
      .select({
        machineModel: schema.products.machineModel,
        brand: schema.products.brand,
      })
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1)

    if (!currentProduct?.machineModel || !currentProduct?.brand) {
      return c.json({ data: [] })
    }

    const related = await db
      .select({
        id: schema.products.id,
        partNumber: schema.products.partNumber,
        name: schema.products.name,
        category: schema.products.category,
        material: schema.products.material,
        size: schema.products.size,
        sellingPrice: schema.products.sellingPrice,
        sellingCurrency: schema.products.sellingCurrency,
        stockQuantity: schema.products.stockQuantity,
      })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.machineModel, currentProduct.machineModel),
          eq(schema.products.brand, currentProduct.brand),
          ne(schema.products.id, id)
        )
      )
      .limit(5)

    return c.json({ data: related })
  } catch (error) {
    console.error('Error fetching related products:', error)
    return c.json({ error: 'Failed to fetch related products' }, 500)
  }
})

// GET /api/products/:id - Get product by ID
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))

  if (isNaN(id)) {
    return c.json({ error: 'Invalid product ID' }, 400)
  }

  try {
    const product = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1)

    if (product.length === 0) {
      return c.json({ error: 'Product not found' }, 404)
    }

    return c.json({ data: product[0] })
  } catch (error) {
    console.error('Error fetching product:', error)
    return c.json({ error: 'Failed to fetch product' }, 500)
  }
})

// POST /api/products - Create new product
app.post('/', async (c) => {
  try {
    const body = await c.req.json()

    // Validate required fields
    if (!body.partNumber || !body.name || !body.category) {
      return c.json(
        { error: 'Missing required fields: partNumber, name, category' },
        400
      )
    }

    const result = await db
      .insert(schema.products)
      .values({
        partNumber: body.partNumber,
        name: body.name,
        nameLocal: body.nameLocal || null,
        category: body.category,
        subcategory: body.subcategory || null,
        brand: body.brand || null,
        machineModel: body.machineModel || null,
        material: body.material || null,
        size: body.size || null,
        specifications: body.specifications || null,
        costPrice: body.costPrice || null,
        costCurrency: body.costCurrency || 'VND',
        sellingPrice: body.sellingPrice || null,
        sellingCurrency: body.sellingCurrency || 'VND',
        marginPercent: body.marginPercent || null,
        isConsumable: body.isConsumable || false,
        stockQuantity: body.stockQuantity || 0,
        reorderLevel: body.reorderLevel || 0,
        unit: body.unit || 'piece',
        imageUrl: body.imageUrl || null,
        status: body.status || 'active',
        tags: body.tags || null,
        notes: body.notes || null,
        remark: body.remark || null,
      })
      .returning()

    return c.json({ data: result[0] }, 201)
  } catch (error: any) {
    console.error('Error creating product:', error)
    if (error.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Product with this part number already exists' }, 409)
    }
    return c.json({ error: 'Failed to create product' }, 500)
  }
})

// PUT /api/products/:id - Update product
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))

  if (isNaN(id)) {
    return c.json({ error: 'Invalid product ID' }, 400)
  }

  try {
    const body = await c.req.json()

    const result = await db
      .update(schema.products)
      .set({
        ...body,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.products.id, id))
      .returning()

    if (result.length === 0) {
      return c.json({ error: 'Product not found' }, 404)
    }

    return c.json({ data: result[0] })
  } catch (error: any) {
    console.error('Error updating product:', error)
    if (error.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Product with this part number already exists' }, 409)
    }
    return c.json({ error: 'Failed to update product' }, 500)
  }
})

// DELETE /api/products/:id - Delete product
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))

  if (isNaN(id)) {
    return c.json({ error: 'Invalid product ID' }, 400)
  }

  try {
    const result = await db
      .delete(schema.products)
      .where(eq(schema.products.id, id))
      .returning()

    if (result.length === 0) {
      return c.json({ error: 'Product not found' }, 404)
    }

    return c.json({ message: 'Product deleted successfully' })
  } catch (error) {
    console.error('Error deleting product:', error)
    return c.json({ error: 'Failed to delete product' }, 500)
  }
})

export default app
