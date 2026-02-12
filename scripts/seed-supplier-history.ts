/**
 * Seed supplier_products + additional order/quote items
 * for a wider range of products (not just first 30).
 * This script ADDS data without deleting existing data.
 */
import { db } from '../server/db/index.js'
import { supplierProducts, orderItems, quoteItems, products, suppliers, orders, quotations } from '../server/db/schema.js'
import { sql, eq } from 'drizzle-orm'

async function seedSupplierAndHistory() {
  console.log('🌱 Seeding supplier_products + additional sales history...\n')

  try {
    // ═══════════════ Get existing data ═══════════════
    const allProducts = await db.select({
      id: products.id,
      partNumber: products.partNumber,
      brand: products.brand,
      category: products.category,
      sellingPrice: products.sellingPrice,
      costPrice: products.costPrice,
    }).from(products)

    const allSuppliers = await db.select({
      id: suppliers.id,
      companyName: suppliers.companyName,
      country: suppliers.country,
    }).from(suppliers)

    const allOrders = await db.select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      customerId: orders.customerId,
    }).from(orders)

    const allQuotations = await db.select({
      id: quotations.id,
      quoteNumber: quotations.quoteNumber,
      customerId: quotations.customerId,
    }).from(quotations)

    console.log(`📦 Found ${allProducts.length} products, ${allSuppliers.length} suppliers`)
    console.log(`📦 Found ${allOrders.length} orders, ${allQuotations.length} quotations`)

    if (allProducts.length === 0 || allSuppliers.length === 0) {
      console.log('⚠️ No products or suppliers found. Run seed-test-data.ts first.')
      return
    }

    // Supplier mapping by brand specialty
    // Supplier 1: Shenzhen Nozzle (China) - Fuji, Panasonic, Yamaha
    // Supplier 2: Tokyo Parts (Japan) - Panasonic, JUKI (premium)
    // Supplier 3: Dongguan SMT (China) - ASM/Siemens, Samsung (budget)
    // Supplier 4: Seoul Precision (Korea) - Samsung, Hanwha
    // Supplier 5: Taiwan SMT Parts (Taiwan) - Yamaha, Hitachi, Casio
    const supplierBrandMap: Record<string, number[]> = {}
    for (const s of allSuppliers) {
      supplierBrandMap[s.id] = []
    }

    function getSupplierForBrand(brand: string | null): number[] {
      if (!brand) return [allSuppliers[0].id] // default to first
      const b = brand.toLowerCase()
      const result: number[] = []
      // Map brand to suppliers
      if (b.includes('fuji')) result.push(allSuppliers[0].id) // Shenzhen
      if (b.includes('panasonic')) {
        result.push(allSuppliers[0].id) // Shenzhen (aftermarket)
        result.push(allSuppliers[1].id) // Tokyo Parts (original)
      }
      if (b.includes('yamaha')) {
        result.push(allSuppliers[0].id) // Shenzhen
        result.push(allSuppliers[4]?.id || allSuppliers[0].id) // Taiwan SMT
      }
      if (b.includes('asm') || b.includes('siemens')) {
        result.push(allSuppliers[2]?.id || allSuppliers[0].id) // Dongguan
      }
      if (b.includes('samsung')) {
        result.push(allSuppliers[2]?.id || allSuppliers[0].id) // Dongguan
        result.push(allSuppliers[3]?.id || allSuppliers[0].id) // Seoul
      }
      if (b.includes('casio') || b.includes('hitachi')) {
        result.push(allSuppliers[4]?.id || allSuppliers[0].id) // Taiwan
      }
      if (b.includes('juki')) {
        result.push(allSuppliers[1]?.id || allSuppliers[0].id) // Tokyo Parts
      }
      return result.length > 0 ? result : [allSuppliers[0].id]
    }

    // ═══════════════ 1. SUPPLIER_PRODUCTS ═══════════════
    // Clear existing supplier_products
    await db.delete(supplierProducts)
    console.log('🧹 Cleared existing supplier_products')

    let spCount = 0
    const purchaseDates = [
      '2025-06-15', '2025-07-20', '2025-08-10', '2025-09-05',
      '2025-10-18', '2025-11-22', '2025-12-10', '2026-01-15', '2026-02-01',
    ]

    for (const product of allProducts) {
      // Only seed nozzle-category products and some others
      if (product.category !== 'nozzle' && Math.random() > 0.3) continue

      const supplierIds = getSupplierForBrand(product.brand)

      for (const supplierId of supplierIds) {
        const baseCost = product.costPrice || (product.sellingPrice ? product.sellingPrice * 0.5 : 200000)
        // Add some variance per supplier
        const supplierObj = allSuppliers.find(s => s.id === supplierId)
        let priceMultiplier = 1.0
        if (supplierObj?.country === 'japan') priceMultiplier = 1.4 // Premium
        if (supplierObj?.country === 'china') priceMultiplier = 0.7 // Budget
        if (supplierObj?.country === 'korea') priceMultiplier = 1.1
        if (supplierObj?.country === 'taiwan') priceMultiplier = 0.9

        const costUSD = Math.round((baseCost / 25000) * priceMultiplier * 100) / 100 // Convert VND to USD approx
        const moq = [5, 10, 20, 50, 100][Math.floor(Math.random() * 5)]
        const leadTime = supplierObj?.country === 'china' ? [5, 7, 10][Math.floor(Math.random() * 3)]
          : supplierObj?.country === 'japan' ? [10, 14, 21][Math.floor(Math.random() * 3)]
          : [7, 10, 14][Math.floor(Math.random() * 3)]

        const lastDate = purchaseDates[Math.floor(Math.random() * purchaseDates.length)]

        await db.insert(supplierProducts).values({
          supplierId,
          productId: product.id,
          costPrice: costUSD,
          costCurrency: 'USD',
          moq,
          leadTimeDays: leadTime,
          lastPurchaseDate: lastDate,
          lastPurchasePrice: costUSD * (0.95 + Math.random() * 0.1), // slight variance
          notes: priceMultiplier > 1.2 ? 'Original parts, premium quality' : priceMultiplier < 0.8 ? 'Aftermarket, good quality' : null,
        })
        spCount++
      }
    }
    console.log(`✅ Created ${spCount} supplier_products entries`)

    // ═══════════════ 2. ADDITIONAL ORDER ITEMS ═══════════════
    // Add order items for products beyond the first 30
    // Spread across existing orders
    const existingOrderItemProductIds = await db
      .select({ productId: orderItems.productId })
      .from(orderItems)
    const existingOIPIds = new Set(existingOrderItemProductIds.map(x => x.productId))

    let addedOrderItems = 0
    // Pick ~60 products that don't have order items yet
    const productsWithoutOrders = allProducts.filter(p => !existingOIPIds.has(p.id))
    const selectedForOrders = productsWithoutOrders
      .filter(p => p.category === 'nozzle' || Math.random() > 0.5)
      .slice(0, 60)

    for (let i = 0; i < selectedForOrders.length; i++) {
      const product = selectedForOrders[i]
      const order = allOrders[i % allOrders.length]
      const quantity = [5, 10, 20, 30, 50][Math.floor(Math.random() * 5)]
      const unitPrice = product.sellingPrice || 500000 + Math.floor(Math.random() * 300000)
      const costPrice = unitPrice * (0.5 + Math.random() * 0.2)

      const supplierIds = getSupplierForBrand(product.brand)
      const supplierId = supplierIds[0]

      await db.insert(orderItems).values({
        orderId: order.id,
        productId: product.id,
        supplierId,
        quantity,
        unitPrice,
        costPrice,
        amount: quantity * unitPrice,
        status: order.status === 'completed' ? 'delivered' : order.status === 'delivered' ? 'received' : 'pending',
      })
      addedOrderItems++
    }
    console.log(`✅ Added ${addedOrderItems} additional order items`)

    // ═══════════════ 3. ADDITIONAL QUOTE ITEMS ═══════════════
    const existingQuoteItemProductIds = await db
      .select({ productId: quoteItems.productId })
      .from(quoteItems)
    const existingQIPIds = new Set(existingQuoteItemProductIds.map(x => x.productId))

    let addedQuoteItems = 0
    const productsWithoutQuotes = allProducts.filter(p => !existingQIPIds.has(p.id))
    const selectedForQuotes = productsWithoutQuotes
      .filter(p => p.category === 'nozzle' || Math.random() > 0.5)
      .slice(0, 50)

    for (let i = 0; i < selectedForQuotes.length; i++) {
      const product = selectedForQuotes[i]
      const quotation = allQuotations[i % allQuotations.length]
      const quantity = [5, 10, 15, 20, 30, 50][Math.floor(Math.random() * 6)]
      const unitPrice = product.sellingPrice || 450000 + Math.floor(Math.random() * 250000)
      const costPrice = unitPrice * (0.5 + Math.random() * 0.2)

      await db.insert(quoteItems).values({
        quotationId: quotation.id,
        productId: product.id,
        quantity,
        unitPrice,
        costPrice,
        amount: quantity * unitPrice,
      })
      addedQuoteItems++
    }
    console.log(`✅ Added ${addedQuoteItems} additional quote items`)

    // ═══════════════ SUMMARY ═══════════════
    console.log('')
    console.log('🎉 Supplier & history data seeding complete!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`  Supplier Products:     ${spCount}`)
    console.log(`  Additional Order Items: ${addedOrderItems}`)
    console.log(`  Additional Quote Items: ${addedQuoteItems}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

seedSupplierAndHistory()
  .then(() => {
    console.log('✅ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })
