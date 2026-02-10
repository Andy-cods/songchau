import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as path from 'path'

const dbPath = path.join(process.cwd(), 'data', 'songchau.db')
const client = createClient({ url: `file:${dbPath}` })
const db = drizzle(client)

async function checkDatabase() {
  console.log('🔍 Checking database structure...\n')

  // Get all tables
  const tables = await db.all(sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  console.log(`✓ Found ${tables.length} tables:`)
  tables.forEach((t: any) => console.log(`  - ${t.name}`))
  console.log()

  // Check required tables
  const requiredTables = [
    'customers',
    'suppliers',
    'products',
    'supplier_products',
    'quotations',
    'quote_items',
    'orders',
    'order_items',
    'pipeline',
    'activities',
    'settings',
    'product_categories'
  ]

  const tableNames = tables.map((t: any) => t.name)
  const missingTables = requiredTables.filter(t => !tableNames.includes(t))

  if (missingTables.length > 0) {
    console.log('❌ Missing tables:', missingTables.join(', '))
  } else {
    console.log('✓ All 12 required tables exist\n')
  }

  // Check products count
  const productCount = await db.get(sql`SELECT COUNT(*) as count FROM products`)
  console.log(`✓ Products in database: ${(productCount as any).count}`)

  if ((productCount as any).count < 200) {
    console.log('⚠️  Products count is less than 200 - may need to reseed')
  }

  // Check other tables
  const customerCount = await db.get(sql`SELECT COUNT(*) as count FROM customers`)
  const supplierCount = await db.get(sql`SELECT COUNT(*) as count FROM suppliers`)
  const quotationCount = await db.get(sql`SELECT COUNT(*) as count FROM quotations`)
  const orderCount = await db.get(sql`SELECT COUNT(*) as count FROM orders`)
  const pipelineCount = await db.get(sql`SELECT COUNT(*) as count FROM pipeline`)

  console.log(`✓ Customers: ${(customerCount as any).count}`)
  console.log(`✓ Suppliers: ${(supplierCount as any).count}`)
  console.log(`✓ Quotations: ${(quotationCount as any).count}`)
  console.log(`✓ Orders: ${(orderCount as any).count}`)
  console.log(`✓ Pipeline deals: ${(pipelineCount as any).count}`)

  console.log('\n✅ Database check complete')
}

checkDatabase().catch(console.error)
