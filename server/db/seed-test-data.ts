import { db } from './index.js'
import { customers, suppliers, activities, quotations, quoteItems, orders, orderItems, pipeline } from './schema.js'
import { sql } from 'drizzle-orm'
import { products } from './schema.js'

async function seedTestData() {
  console.log('🌱 Seeding comprehensive test data...')

  try {
    // Clean existing test data (preserve products/categories)
    console.log('🧹 Cleaning existing data...')
    await db.delete(activities)
    await db.delete(quoteItems)
    await db.delete(orderItems)
    await db.delete(pipeline)
    await db.delete(orders)
    await db.delete(quotations)
    await db.delete(suppliers)
    await db.delete(customers)
    console.log('✅ Cleaned existing data')

    // ═══════════════ 1. CUSTOMERS (12) ═══════════════
    const customerData = [
      {
        companyName: 'Samsung Display Vietnam',
        companyNameLocal: 'Samsung Display Việt Nam',
        type: 'fdi_korea', industry: 'electronics',
        industrialZone: 'KCN Yên Phong (Bắc Ninh)', province: 'Bắc Ninh',
        address: 'Khu công nghiệp Yên Phong, Bắc Ninh',
        contactName: 'Mr. Kim Jong-soo', contactTitle: 'Purchasing Manager',
        contactPhone: '0912345678', contactEmail: 'kim.jongsoo@samsung.com',
        contactZalo: '0912345678',
        smtBrands: JSON.stringify(['Samsung', 'Panasonic', 'Fuji']),
        smtModels: 'SM481, SM471, NPM-W2',
        purchaseFrequency: 'monthly', estimatedAnnualValue: 5000000000,
        paymentTerms: 'net30', tier: 'A', status: 'active', source: 'direct',
        notes: 'Large volume customer, high priority. Monthly nozzle orders.',
        createdAt: '2025-06-15T10:00:00.000Z',
      },
      {
        companyName: 'Canon Vietnam Co., Ltd',
        companyNameLocal: 'Công ty TNHH Canon Việt Nam',
        type: 'fdi_japan', industry: 'electronics',
        industrialZone: 'KCN Thăng Long (Hà Nội)', province: 'Hà Nội',
        address: 'Lô J1-J2, KCN Thăng Long, Đông Anh, Hà Nội',
        contactName: 'Mr. Tanaka Hiroshi', contactTitle: 'Production Engineer',
        contactPhone: '0987654321', contactEmail: 'tanaka.h@canon.vn',
        contact2Name: 'Ms. Nguyễn Thị Hoa', contact2Title: 'Procurement Staff',
        contact2Phone: '0976543210', contact2Email: 'hoa.nt@canon.vn',
        smtBrands: JSON.stringify(['Panasonic', 'JUKI']),
        smtModels: 'NPM-W2, KE-2080',
        purchaseFrequency: 'monthly', estimatedAnnualValue: 3000000000,
        paymentTerms: 'net30', tier: 'A', status: 'active', source: 'exhibition',
        notes: 'Focus on Panasonic nozzles. Regular monthly orders.',
        createdAt: '2025-07-20T08:30:00.000Z',
      },
      {
        companyName: 'Foxconn Bắc Giang',
        companyNameLocal: 'Foxconn Bắc Giang',
        type: 'fdi_taiwan', industry: 'electronics',
        industrialZone: 'KCN Đình Trám (Bắc Giang)', province: 'Bắc Giang',
        address: 'KCN Đình Trám, Việt Yên, Bắc Giang',
        contactName: 'Mr. Lin Wei', contactTitle: 'Procurement Director',
        contactPhone: '0934567890', contactEmail: 'linwei@foxconn.com',
        contactWechat: 'linwei_foxconn',
        smtBrands: JSON.stringify(['Panasonic', 'Fuji', 'ASM/Siemens']),
        smtModels: 'NPM-W2, NXT-III, SIPLACE X',
        purchaseFrequency: 'weekly', estimatedAnnualValue: 8000000000,
        paymentTerms: 'net45', tier: 'A', status: 'active', source: 'referral',
        notes: 'Biggest volume. Weekly orders for multiple SMT lines. VIP treatment.',
        createdAt: '2025-08-05T14:00:00.000Z',
      },
      {
        companyName: 'LG Electronics Vietnam',
        companyNameLocal: 'LG Electronics Việt Nam',
        type: 'fdi_korea', industry: 'electronics',
        industrialZone: 'KCN Tràng Duệ (Hải Phòng)', province: 'Hải Phòng',
        address: 'KCN Tràng Duệ, An Dương, Hải Phòng',
        contactName: 'Mr. Park Min-jun', contactTitle: 'Equipment Manager',
        contactPhone: '0923456789', contactEmail: 'park.minjun@lge.com',
        smtBrands: JSON.stringify(['Samsung', 'Yamaha']),
        smtModels: 'SM481, YSM40',
        purchaseFrequency: 'monthly', estimatedAnnualValue: 2000000000,
        paymentTerms: 'net30', tier: 'B', status: 'active', source: 'cold_call',
        createdAt: '2025-09-10T09:00:00.000Z',
      },
      {
        companyName: 'Goertek Vina Co., Ltd',
        companyNameLocal: 'Goertek Vina',
        type: 'fdi_china', industry: 'electronics',
        industrialZone: 'KCN Quế Võ (Bắc Ninh)', province: 'Bắc Ninh',
        address: 'KCN Quế Võ, Bắc Ninh',
        contactName: 'Mr. Wang Li', contactTitle: 'Supply Chain Manager',
        contactPhone: '0945678901', contactEmail: 'wangli@goertek.com',
        contactWechat: 'wangli_goertek',
        smtBrands: JSON.stringify(['Fuji', 'Panasonic']),
        smtModels: 'NXT-H08M, NPM-D3',
        purchaseFrequency: 'weekly', estimatedAnnualValue: 6000000000,
        paymentTerms: 'net45', tier: 'A', status: 'active', source: 'referral',
        notes: 'Audio component manufacturer. Very high volume.',
        createdAt: '2025-10-01T11:00:00.000Z',
      },
      {
        companyName: 'Meiko Electronics Vietnam',
        companyNameLocal: 'Meiko Electronics Việt Nam',
        type: 'fdi_japan', industry: 'pcb',
        industrialZone: 'KCN Thạch Thất (Hà Nội)', province: 'Hà Nội',
        address: 'KCN Thạch Thất, Quốc Oai, Hà Nội',
        contactName: 'Mr. Sato Kenji', contactTitle: 'Factory Manager',
        contactPhone: '0956789012', contactEmail: 'sato.k@meiko-elec.com',
        smtBrands: JSON.stringify(['Panasonic']),
        smtModels: 'NPM-W2, NPM-D3',
        purchaseFrequency: 'monthly', estimatedAnnualValue: 1500000000,
        paymentTerms: 'net30', tier: 'B', status: 'active', source: 'exhibition',
        createdAt: '2025-10-15T10:00:00.000Z',
      },
      {
        companyName: 'Panasonic Vietnam Co., Ltd',
        companyNameLocal: 'Panasonic Việt Nam',
        type: 'fdi_japan', industry: 'electronics',
        industrialZone: 'KCN Bình Dương', province: 'Bình Dương',
        address: 'KCN VSIP, Thuận An, Bình Dương',
        contactName: 'Mr. Yamamoto Taro', contactTitle: 'Technical Director',
        contactPhone: '0967890123', contactEmail: 'yamamoto@panasonic.vn',
        smtBrands: JSON.stringify(['Panasonic']),
        smtModels: 'NPM-W2, NPM-TT2, AM100',
        purchaseFrequency: 'monthly', estimatedAnnualValue: 2500000000,
        paymentTerms: 'net30', tier: 'A', status: 'active', source: 'direct',
        createdAt: '2025-11-01T08:00:00.000Z',
      },
      {
        companyName: 'Amkor Technology Vietnam',
        companyNameLocal: 'Amkor Technology Việt Nam',
        type: 'fdi_korea', industry: 'semiconductor',
        industrialZone: 'KCN Yên Phong II (Bắc Ninh)', province: 'Bắc Ninh',
        address: 'KCN Yên Phong II, Bắc Ninh',
        contactName: 'Mr. Lee Sang-hoon', contactTitle: 'Equipment Engineer',
        contactPhone: '0978901234', contactEmail: 'lee.sh@amkor.com',
        smtBrands: JSON.stringify(['ASM/Siemens', 'Yamaha']),
        smtModels: 'SIPLACE TX, YSM40',
        purchaseFrequency: 'quarterly', estimatedAnnualValue: 1200000000,
        paymentTerms: 'net30', tier: 'B', status: 'active', source: 'online',
        createdAt: '2025-11-20T13:00:00.000Z',
      },
      {
        companyName: 'Hanwha Solutions Vietnam',
        companyNameLocal: 'Hanwha Solutions Việt Nam',
        type: 'fdi_korea', industry: 'electronics',
        industrialZone: 'KCN Đại An (Hải Dương)', province: 'Hải Dương',
        address: 'KCN Đại An, TP Hải Dương',
        contactName: 'Ms. Choi Yuna', contactTitle: 'Purchasing Specialist',
        contactPhone: '0989012345', contactEmail: 'choi.yuna@hanwha.com',
        smtBrands: JSON.stringify(['Samsung', 'Hanwha']),
        smtModels: 'SM481, SM482, HM520',
        purchaseFrequency: 'monthly', estimatedAnnualValue: 1800000000,
        paymentTerms: 'net30', tier: 'B', status: 'active', source: 'exhibition',
        createdAt: '2025-12-05T10:30:00.000Z',
      },
      {
        companyName: 'VSIP Electronics Co.',
        companyNameLocal: 'VSIP Electronics',
        type: 'domestic', industry: 'pcb',
        industrialZone: 'VSIP Bắc Ninh', province: 'Bắc Ninh',
        address: 'VSIP Bắc Ninh, Từ Sơn, Bắc Ninh',
        contactName: 'Ông Trần Văn Minh', contactTitle: 'Giám đốc sản xuất',
        contactPhone: '0890123456', contactEmail: 'minh.tv@vsip-elec.vn',
        contactZalo: '0890123456',
        smtBrands: JSON.stringify(['Fuji', 'Yamaha']),
        smtModels: 'NXT-III, YSM20',
        purchaseFrequency: 'quarterly', estimatedAnnualValue: 800000000,
        paymentTerms: 'net15', tier: 'C', status: 'active', source: 'cold_call',
        createdAt: '2025-12-20T09:00:00.000Z',
      },
      {
        companyName: 'Hanel PT Co., Ltd',
        companyNameLocal: 'Công ty TNHH Hanel PT',
        type: 'domestic', industry: 'electronics',
        industrialZone: 'KCN Sài Đồng (Hà Nội)', province: 'Hà Nội',
        address: 'KCN Sài Đồng, Long Biên, Hà Nội',
        contactName: 'Ông Nguyễn Đức Anh', contactTitle: 'Trưởng phòng vật tư',
        contactPhone: '0901234567', contactEmail: 'ducanh@hanelpt.vn',
        contactZalo: '0901234567',
        smtBrands: JSON.stringify(['Panasonic', 'Casio']),
        smtModels: 'AM100, YCM-7000',
        purchaseFrequency: 'as_needed', estimatedAnnualValue: 400000000,
        paymentTerms: 'cod', tier: 'C', status: 'active', source: 'referral',
        createdAt: '2026-01-10T15:00:00.000Z',
      },
      {
        companyName: 'VinSmart Technology JSC',
        companyNameLocal: 'CTCP Công nghệ VinSmart',
        type: 'domestic', industry: 'electronics',
        industrialZone: 'Khu CNC Hòa Lạc (Hà Nội)', province: 'Hà Nội',
        address: 'Khu CNC Hòa Lạc, Thạch Thất, Hà Nội',
        contactName: 'Ông Phạm Quang Huy', contactTitle: 'Giám đốc kỹ thuật',
        contactPhone: '0812345678', contactEmail: 'huy.pq@vinsmart.vn',
        smtBrands: JSON.stringify(['Fuji', 'Yamaha', 'ASM/Siemens']),
        smtModels: 'NXT-H12, YSM40, SIPLACE SX',
        purchaseFrequency: 'monthly', estimatedAnnualValue: 3500000000,
        paymentTerms: 'net30', tier: 'A', status: 'active', source: 'direct',
        createdAt: '2026-01-25T11:00:00.000Z',
      },
    ]

    const insertedCustomers = []
    for (const c of customerData) {
      const [inserted] = await db.insert(customers).values(c).returning()
      insertedCustomers.push(inserted)
    }
    console.log(`✅ Created ${insertedCustomers.length} customers`)

    // ═══════════════ 2. SUPPLIERS (5) ═══════════════
    const supplierData = [
      {
        companyName: 'Shenzhen Nozzle Co., Ltd',
        companyNameLocal: '深圳市喷嘴有限公司',
        country: 'china',
        contactName: 'Mr. Zhang Wei', contactPhone: '+86 755 1234 5678',
        contactEmail: 'sales@sz-nozzle.com', contactWechat: 'sz_nozzle_sales',
        platform: 'alibaba', platformUrl: 'https://sz-nozzle.en.alibaba.com',
        rating: 4, qualityScore: 8, deliveryScore: 7, priceScore: 9,
        speciality: JSON.stringify(['Fuji Nozzles', 'Panasonic Nozzles', 'Yamaha Nozzles']),
        brands: JSON.stringify(['Fuji', 'Panasonic', 'Yamaha']),
        minOrderValue: 500, leadTimeDays: 7,
        paymentMethods: JSON.stringify(['T/T', 'Alibaba Trade Assurance']),
        status: 'active',
        notes: 'Good supplier for Fuji nozzles. Fast delivery, competitive prices.',
        createdAt: '2025-06-01T10:00:00.000Z',
      },
      {
        companyName: 'Tokyo Parts Trading Co.',
        companyNameLocal: '東京パーツトレーディング株式会社',
        country: 'japan',
        contactName: 'Mr. Suzuki Takeshi', contactPhone: '+81 3 5678 1234',
        contactEmail: 'suzuki@tokyo-parts.co.jp',
        platform: 'direct',
        rating: 5, qualityScore: 10, deliveryScore: 8, priceScore: 5,
        speciality: JSON.stringify(['Original Panasonic Parts', 'JUKI Parts']),
        brands: JSON.stringify(['Panasonic', 'JUKI']),
        minOrderValue: 1000, leadTimeDays: 14,
        paymentMethods: JSON.stringify(['T/T', 'L/C']),
        status: 'active',
        notes: 'Premium original parts. Expensive but highest quality.',
        createdAt: '2025-07-01T10:00:00.000Z',
      },
      {
        companyName: 'Dongguan SMT Equipment Co.',
        companyNameLocal: '东莞SMT设备有限公司',
        country: 'china',
        contactName: 'Ms. Li Mei', contactPhone: '+86 769 8765 4321',
        contactEmail: 'limei@dg-smt.com', contactWechat: 'dg_smt_limei',
        platform: '1688',
        rating: 3, qualityScore: 6, deliveryScore: 8, priceScore: 10,
        speciality: JSON.stringify(['ASM/Siemens Nozzles', 'Feeder Parts', 'Samsung Nozzles']),
        brands: JSON.stringify(['ASM/Siemens', 'Samsung']),
        minOrderValue: 200, leadTimeDays: 5,
        paymentMethods: JSON.stringify(['T/T', 'Alipay']),
        status: 'active',
        notes: 'Budget option. Quality acceptable for less critical parts.',
        createdAt: '2025-08-01T10:00:00.000Z',
      },
      {
        companyName: 'Seoul Precision Co., Ltd',
        companyNameLocal: '서울정밀 주식회사',
        country: 'korea',
        contactName: 'Mr. Kim Tae-hyung', contactPhone: '+82 2 3456 7890',
        contactEmail: 'kimth@seoul-precision.kr',
        platform: 'direct',
        rating: 4, qualityScore: 9, deliveryScore: 7, priceScore: 6,
        speciality: JSON.stringify(['Samsung Nozzles', 'Samsung Feeders']),
        brands: JSON.stringify(['Samsung', 'Hanwha']),
        minOrderValue: 800, leadTimeDays: 10,
        paymentMethods: JSON.stringify(['T/T', 'Wire Transfer']),
        status: 'active',
        createdAt: '2025-09-01T10:00:00.000Z',
      },
      {
        companyName: 'Taiwan SMT Parts Co.',
        companyNameLocal: '台灣SMT零件有限公司',
        country: 'taiwan',
        contactName: 'Mr. Chen Wei-lin', contactPhone: '+886 2 2345 6789',
        contactEmail: 'chen@tw-smt.com.tw', contactLine: 'tw_smt_chen',
        platform: 'smtnet',
        rating: 4, qualityScore: 8, deliveryScore: 8, priceScore: 7,
        speciality: JSON.stringify(['Yamaha Nozzles', 'Hitachi Parts', 'Casio Parts']),
        brands: JSON.stringify(['Yamaha', 'Hitachi', 'Casio']),
        minOrderValue: 600, leadTimeDays: 10,
        paymentMethods: JSON.stringify(['T/T']),
        status: 'active',
        createdAt: '2025-10-01T10:00:00.000Z',
      },
    ]

    const insertedSuppliers = []
    for (const s of supplierData) {
      const [inserted] = await db.insert(suppliers).values(s).returning()
      insertedSuppliers.push(inserted)
    }
    console.log(`✅ Created ${insertedSuppliers.length} suppliers`)

    // ═══════════════ 3. Get some product IDs ═══════════════
    const sampleProducts = await db
      .select({ id: products.id, partNumber: products.partNumber, name: products.name, sellingPrice: products.sellingPrice })
      .from(products)
      .limit(30)

    if (sampleProducts.length === 0) {
      console.log('⚠️ No products found. Run seed.ts first.')
      return
    }
    console.log(`📦 Found ${sampleProducts.length} products for reference`)

    // ═══════════════ 4. QUOTATIONS (8) ═══════════════
    const quotationData = [
      // Q1: Samsung - Accepted (oldest)
      {
        quoteNumber: 'SC-Q-2025-0001',
        customerId: insertedCustomers[0].id, // Samsung
        status: 'accepted',
        subtotal: 75000000, taxRate: 10, taxAmount: 7500000, totalAmount: 82500000,
        currency: 'VND',
        validUntil: '2025-08-30T00:00:00.000Z',
        sentAt: '2025-07-18T10:00:00.000Z',
        acceptedAt: '2025-07-22T14:00:00.000Z',
        notes: 'Nozzle set for H08 and H12 lines',
        createdAt: '2025-07-15T10:00:00.000Z',
      },
      // Q2: Canon - Accepted
      {
        quoteNumber: 'SC-Q-2025-0002',
        customerId: insertedCustomers[1].id, // Canon
        status: 'accepted',
        subtotal: 45000000, taxRate: 10, taxAmount: 4500000, totalAmount: 49500000,
        currency: 'VND',
        validUntil: '2025-09-30T00:00:00.000Z',
        sentAt: '2025-08-20T08:00:00.000Z',
        acceptedAt: '2025-08-25T10:00:00.000Z',
        notes: 'Panasonic NPM nozzle replacement set',
        createdAt: '2025-08-18T09:00:00.000Z',
      },
      // Q3: Foxconn - Accepted (big deal)
      {
        quoteNumber: 'SC-Q-2025-0003',
        customerId: insertedCustomers[2].id, // Foxconn
        status: 'accepted',
        subtotal: 250000000, taxRate: 10, taxAmount: 25000000, totalAmount: 275000000,
        currency: 'VND',
        validUntil: '2025-10-30T00:00:00.000Z',
        sentAt: '2025-09-22T14:00:00.000Z',
        acceptedAt: '2025-09-28T09:00:00.000Z',
        notes: 'Full nozzle + feeder package for new SMT line',
        createdAt: '2025-09-20T11:00:00.000Z',
      },
      // Q4: Goertek - Sent (pending)
      {
        quoteNumber: 'SC-Q-2025-0004',
        customerId: insertedCustomers[4].id, // Goertek
        status: 'sent',
        subtotal: 120000000, taxRate: 10, taxAmount: 12000000, totalAmount: 132000000,
        currency: 'VND',
        validUntil: '2026-03-15T00:00:00.000Z',
        sentAt: '2026-01-20T10:00:00.000Z',
        notes: 'Fuji NXT nozzles for audio assembly line',
        createdAt: '2026-01-18T14:00:00.000Z',
      },
      // Q5: LG - Rejected
      {
        quoteNumber: 'SC-Q-2025-0005',
        customerId: insertedCustomers[3].id, // LG
        status: 'rejected',
        subtotal: 35000000, taxRate: 10, taxAmount: 3500000, totalAmount: 38500000,
        currency: 'VND',
        validUntil: '2025-12-31T00:00:00.000Z',
        sentAt: '2025-11-10T08:00:00.000Z',
        notes: 'Samsung SM nozzle set - client found cheaper',
        createdAt: '2025-11-08T10:00:00.000Z',
      },
      // Q6: VinSmart - Draft
      {
        quoteNumber: 'SC-Q-2026-0001',
        customerId: insertedCustomers[11].id, // VinSmart
        status: 'draft',
        subtotal: 180000000, taxRate: 10, taxAmount: 18000000, totalAmount: 198000000,
        currency: 'VND',
        validUntil: '2026-03-31T00:00:00.000Z',
        notes: 'Multi-brand nozzle package for 3 SMT lines',
        createdAt: '2026-02-05T11:00:00.000Z',
      },
      // Q7: Panasonic VN - Sent
      {
        quoteNumber: 'SC-Q-2026-0002',
        customerId: insertedCustomers[6].id, // Panasonic VN
        status: 'sent',
        subtotal: 95000000, taxRate: 10, taxAmount: 9500000, totalAmount: 104500000,
        currency: 'VND',
        validUntil: '2026-03-30T00:00:00.000Z',
        sentAt: '2026-02-02T09:00:00.000Z',
        notes: 'NPM nozzle wear replacement',
        createdAt: '2026-02-01T10:00:00.000Z',
      },
      // Q8: Hanwha - Accepted
      {
        quoteNumber: 'SC-Q-2025-0006',
        customerId: insertedCustomers[8].id, // Hanwha
        status: 'accepted',
        subtotal: 65000000, taxRate: 10, taxAmount: 6500000, totalAmount: 71500000,
        currency: 'VND',
        validUntil: '2026-01-31T00:00:00.000Z',
        sentAt: '2025-12-12T10:00:00.000Z',
        acceptedAt: '2025-12-18T15:00:00.000Z',
        notes: 'Samsung nozzles for HM520 line',
        createdAt: '2025-12-10T09:00:00.000Z',
      },
    ]

    const insertedQuotations = []
    for (const q of quotationData) {
      const [inserted] = await db.insert(quotations).values(q).returning()
      insertedQuotations.push(inserted)
    }
    console.log(`✅ Created ${insertedQuotations.length} quotations`)

    // Quote items (3-5 items per quotation, using real product IDs)
    const p = sampleProducts
    for (const q of insertedQuotations) {
      const numItems = 3 + Math.floor(Math.random() * 3) // 3-5 items
      for (let i = 0; i < Math.min(numItems, p.length); i++) {
        const product = p[i + (insertedQuotations.indexOf(q) * 3) % p.length]
        const quantity = (Math.floor(Math.random() * 10) + 1) * 10 // 10-100
        const unitPrice = (product.sellingPrice || 500000) + Math.floor(Math.random() * 200000)
        await db.insert(quoteItems).values({
          quotationId: q.id,
          productId: product.id,
          quantity,
          unitPrice,
          costPrice: unitPrice * 0.6,
          amount: quantity * unitPrice,
        })
      }
    }
    console.log(`✅ Created quote items for all quotations`)

    // ═══════════════ 5. ORDERS (6) ═══════════════
    const orderData = [
      // O1: Samsung - Completed (July)
      {
        orderNumber: 'SC-PO-2025-0001',
        quotationId: insertedQuotations[0].id,
        customerId: insertedCustomers[0].id,
        status: 'completed',
        totalAmount: 82500000, currency: 'VND',
        paymentStatus: 'paid', paidAmount: 82500000,
        expectedDelivery: '2025-08-10T00:00:00.000Z',
        actualDelivery: '2025-08-08T00:00:00.000Z',
        deliveryAddress: 'KCN Yên Phong, Bắc Ninh',
        trackingNumber: 'VN1234567890',
        notes: 'Delivered on time. Customer satisfied.',
        createdAt: '2025-07-25T10:00:00.000Z',
      },
      // O2: Canon - Completed (September)
      {
        orderNumber: 'SC-PO-2025-0002',
        quotationId: insertedQuotations[1].id,
        customerId: insertedCustomers[1].id,
        status: 'completed',
        totalAmount: 49500000, currency: 'VND',
        paymentStatus: 'paid', paidAmount: 49500000,
        expectedDelivery: '2025-09-15T00:00:00.000Z',
        actualDelivery: '2025-09-14T00:00:00.000Z',
        deliveryAddress: 'KCN Thăng Long, Đông Anh, Hà Nội',
        trackingNumber: 'VN2345678901',
        createdAt: '2025-08-28T09:00:00.000Z',
      },
      // O3: Foxconn - Delivered (October) - big order
      {
        orderNumber: 'SC-PO-2025-0003',
        quotationId: insertedQuotations[2].id,
        customerId: insertedCustomers[2].id,
        status: 'delivered',
        totalAmount: 275000000, currency: 'VND',
        paymentStatus: 'partial', paidAmount: 200000000,
        paymentDueDate: '2026-02-28T00:00:00.000Z',
        expectedDelivery: '2025-11-01T00:00:00.000Z',
        actualDelivery: '2025-10-30T00:00:00.000Z',
        deliveryAddress: 'KCN Đình Trám, Bắc Giang',
        trackingNumber: 'VN3456789012',
        notes: 'Large order. Partial payment received.',
        createdAt: '2025-10-02T14:00:00.000Z',
      },
      // O4: Hanwha - In Transit (December)
      {
        orderNumber: 'SC-PO-2025-0004',
        quotationId: insertedQuotations[7].id,
        customerId: insertedCustomers[8].id,
        status: 'in_transit',
        totalAmount: 71500000, currency: 'VND',
        paymentStatus: 'unpaid', paidAmount: 0,
        paymentDueDate: '2026-02-15T00:00:00.000Z',
        expectedDelivery: '2026-02-20T00:00:00.000Z',
        deliveryAddress: 'KCN Đại An, Hải Dương',
        trackingNumber: 'CN7890123456',
        createdAt: '2025-12-20T10:00:00.000Z',
      },
      // O5: Goertek - Purchasing (January)
      {
        orderNumber: 'SC-PO-2026-0001',
        customerId: insertedCustomers[4].id,
        status: 'purchasing',
        totalAmount: 95000000, currency: 'VND',
        paymentStatus: 'unpaid', paidAmount: 0,
        expectedDelivery: '2026-03-01T00:00:00.000Z',
        deliveryAddress: 'KCN Quế Võ, Bắc Ninh',
        notes: 'Urgent order for maintenance schedule.',
        createdAt: '2026-01-28T11:00:00.000Z',
      },
      // O6: Samsung - Confirmed (February)
      {
        orderNumber: 'SC-PO-2026-0002',
        customerId: insertedCustomers[0].id,
        status: 'confirmed',
        totalAmount: 115000000, currency: 'VND',
        paymentStatus: 'unpaid', paidAmount: 0,
        expectedDelivery: '2026-03-15T00:00:00.000Z',
        deliveryAddress: 'KCN Yên Phong, Bắc Ninh',
        notes: 'Monthly replenishment order.',
        createdAt: '2026-02-08T09:00:00.000Z',
      },
    ]

    const insertedOrders = []
    for (const o of orderData) {
      const [inserted] = await db.insert(orders).values(o).returning()
      insertedOrders.push(inserted)
    }
    console.log(`✅ Created ${insertedOrders.length} orders`)

    // Order items
    for (const o of insertedOrders) {
      const numItems = 2 + Math.floor(Math.random() * 3) // 2-4 items
      for (let i = 0; i < Math.min(numItems, p.length); i++) {
        const product = p[(i + insertedOrders.indexOf(o) * 4) % p.length]
        const quantity = (Math.floor(Math.random() * 5) + 1) * 10
        const unitPrice = (product.sellingPrice || 500000) + Math.floor(Math.random() * 150000)
        await db.insert(orderItems).values({
          orderId: o.id,
          productId: product.id,
          supplierId: insertedSuppliers[Math.floor(Math.random() * insertedSuppliers.length)].id,
          quantity,
          unitPrice,
          costPrice: unitPrice * 0.6,
          amount: quantity * unitPrice,
          status: o.status === 'completed' ? 'delivered' : o.status === 'delivered' ? 'received' : 'pending',
        })
      }
    }
    console.log(`✅ Created order items for all orders`)

    // ═══════════════ 6. PIPELINE DEALS (5) ═══════════════
    const pipelineData = [
      {
        customerId: insertedCustomers[3].id, // LG
        title: 'LG Display - Nozzle Package 2026',
        stage: 'lead', dealValue: 150000000, currency: 'VND', probability: 20,
        expectedCloseDate: '2026-04-30T00:00:00.000Z',
        assignedTo: 'Sales Team',
        notes: 'Initial inquiry from LG. Needs follow-up.',
        createdAt: '2026-02-01T10:00:00.000Z',
      },
      {
        customerId: insertedCustomers[5].id, // Meiko
        title: 'Meiko - NPM Maintenance Kit',
        stage: 'qualified', dealValue: 85000000, currency: 'VND', probability: 40,
        expectedCloseDate: '2026-03-31T00:00:00.000Z',
        assignedTo: 'Sales Team',
        notes: 'Budget approved. Awaiting specs confirmation.',
        createdAt: '2026-01-15T09:00:00.000Z',
      },
      {
        customerId: insertedCustomers[11].id, // VinSmart
        title: 'VinSmart - Full Line Setup',
        stage: 'proposal', dealValue: 500000000, currency: 'VND', probability: 50,
        expectedCloseDate: '2026-05-15T00:00:00.000Z',
        quotationId: insertedQuotations[5].id,
        assignedTo: 'Sales Team',
        notes: 'Big deal. 3 new SMT lines. Quotation sent.',
        createdAt: '2026-01-20T14:00:00.000Z',
      },
      {
        customerId: insertedCustomers[4].id, // Goertek
        title: 'Goertek - Q2 Nozzle Supply Contract',
        stage: 'negotiation', dealValue: 350000000, currency: 'VND', probability: 70,
        expectedCloseDate: '2026-03-15T00:00:00.000Z',
        assignedTo: 'Sales Team',
        notes: 'Negotiating quarterly contract. Good chance.',
        createdAt: '2025-12-20T10:00:00.000Z',
      },
      {
        customerId: insertedCustomers[0].id, // Samsung
        title: 'Samsung - Annual Supply Agreement 2026',
        stage: 'won', dealValue: 800000000, currency: 'VND', probability: 100,
        expectedCloseDate: '2025-12-31T00:00:00.000Z',
        actualCloseDate: '2025-12-28T00:00:00.000Z',
        assignedTo: 'Sales Team',
        notes: 'Annual contract renewed. Great result!',
        createdAt: '2025-11-01T10:00:00.000Z',
      },
    ]

    for (const deal of pipelineData) {
      await db.insert(pipeline).values(deal)
    }
    console.log(`✅ Created ${pipelineData.length} pipeline deals`)

    // ═══════════════ 7. ACTIVITIES (28) ═══════════════
    const activityData = [
      // Samsung activities
      { entityType: 'customer', entityId: insertedCustomers[0].id, type: 'call',
        title: 'Gọi điện hỏi thăm', content: 'Gọi Mr. Kim. Cần báo giá nozzle Fuji NXT H08/H12. Số lượng ~50 cái mỗi loại.',
        followUpAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), followUpDone: false,
        createdAt: '2026-02-08T09:00:00.000Z' },
      { entityType: 'customer', entityId: insertedCustomers[0].id, type: 'email',
        title: 'Gửi báo giá nozzle H08/H12', content: 'Đã gửi báo giá SC-Q-2026-0002 cho Samsung. Giá trị 115tr VND.',
        createdAt: '2026-02-06T14:00:00.000Z' },
      { entityType: 'customer', entityId: insertedCustomers[0].id, type: 'meeting',
        title: 'Họp review đơn hàng Q4', content: 'Họp với Mr. Kim tại Samsung. Review performance Q4/2025. KH rất hài lòng.',
        createdAt: '2026-01-15T10:00:00.000Z' },
      { entityType: 'customer', entityId: insertedCustomers[0].id, type: 'payment_received',
        title: 'Thanh toán PO-2025-0001', content: 'Samsung thanh toán đầy đủ 82,500,000 VND cho đơn SC-PO-2025-0001.',
        createdAt: '2025-08-15T10:00:00.000Z' },

      // Canon activities
      { entityType: 'customer', entityId: insertedCustomers[1].id, type: 'visit',
        title: 'Thăm nhà máy Canon', content: 'Đi thăm Canon Thăng Long. Kiểm tra tình trạng nozzle. Cần thay set NPM.',
        createdAt: '2025-08-10T08:30:00.000Z' },
      { entityType: 'customer', entityId: insertedCustomers[1].id, type: 'quotation_sent',
        title: 'Gửi BG nozzle NPM', content: 'Gửi báo giá SC-Q-2025-0002. Panasonic NPM nozzle set.',
        createdAt: '2025-08-20T09:00:00.000Z' },
      { entityType: 'customer', entityId: insertedCustomers[1].id, type: 'order_placed',
        title: 'Canon đặt hàng', content: 'Canon confirm đơn hàng SC-PO-2025-0002. Giao trước 15/09.',
        createdAt: '2025-08-28T10:00:00.000Z' },

      // Foxconn activities
      { entityType: 'customer', entityId: insertedCustomers[2].id, type: 'call',
        title: 'Foxconn yêu cầu báo giá lớn', content: 'Mr. Lin gọi. Cần full package cho line mới: nozzle + feeder + spare parts.',
        createdAt: '2025-09-18T11:00:00.000Z' },
      { entityType: 'customer', entityId: insertedCustomers[2].id, type: 'meeting',
        title: 'Họp thương lượng Foxconn', content: 'Họp tại Foxconn Bắc Giang. Thương lượng giá cho đơn 275tr. Đã chốt.',
        createdAt: '2025-09-25T14:00:00.000Z' },
      { entityType: 'customer', entityId: insertedCustomers[2].id, type: 'follow_up',
        title: 'Follow-up thanh toán Foxconn', content: 'Foxconn còn nợ 75tr cho PO-2025-0003. Hẹn thanh toán cuối tháng 2.',
        followUpAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), followUpDone: false,
        createdAt: '2026-02-01T10:00:00.000Z' },

      // Goertek activities
      { entityType: 'customer', entityId: insertedCustomers[4].id, type: 'zalo',
        title: 'Zalo với Mr. Wang', content: 'Chat Zalo. Goertek cần nozzle gấp cho maintenance schedule tuần sau.',
        createdAt: '2026-01-25T15:00:00.000Z' },
      { entityType: 'customer', entityId: insertedCustomers[4].id, type: 'email',
        title: 'Gửi BG cho Goertek', content: 'Gửi báo giá SC-Q-2025-0004 qua email. Fuji NXT nozzles.',
        createdAt: '2026-01-20T10:30:00.000Z' },

      // LG activities
      { entityType: 'customer', entityId: insertedCustomers[3].id, type: 'call',
        title: 'Cold call LG Hải Phòng', content: 'Gọi Mr. Park. LG đang tìm nguồn nozzle mới. Hẹn gặp tuần sau.',
        followUpAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), followUpDone: false,
        createdAt: '2026-02-03T09:00:00.000Z' },

      // VinSmart activities
      { entityType: 'customer', entityId: insertedCustomers[11].id, type: 'visit',
        title: 'Khảo sát nhà máy VinSmart', content: 'Khảo sát 3 line SMT. Fuji NXT + Yamaha YSM40 + Siemens. Cần full package.',
        createdAt: '2026-01-22T09:00:00.000Z' },
      { entityType: 'customer', entityId: insertedCustomers[11].id, type: 'note',
        title: 'Ghi chú VinSmart specs', content: 'Line 1: NXT-H12 (12 head). Line 2: YSM40. Line 3: SIPLACE SX. Total ~180 nozzles.',
        createdAt: '2026-01-23T10:00:00.000Z' },

      // Panasonic VN activities
      { entityType: 'customer', entityId: insertedCustomers[6].id, type: 'email',
        title: 'BG NPM nozzle cho Panasonic VN', content: 'Gửi BG SC-Q-2026-0002 cho Mr. Yamamoto. NPM nozzle wear replacement.',
        createdAt: '2026-02-02T09:30:00.000Z' },
      { entityType: 'customer', entityId: insertedCustomers[6].id, type: 'follow_up',
        title: 'Follow-up BG Panasonic VN', content: 'Gửi BG 1 tuần rồi chưa phản hồi. Cần gọi lại Mr. Yamamoto.',
        followUpAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(), followUpDone: false,
        createdAt: '2026-02-09T10:00:00.000Z' },

      // Supplier activities
      { entityType: 'supplier', entityId: insertedSuppliers[0].id, type: 'wechat',
        title: 'Chat WeChat Shenzhen Nozzle', content: 'Đặt hàng 200 nozzle Fuji NXT. Mr. Zhang xác nhận giao sau 7 ngày.',
        createdAt: '2026-01-28T14:00:00.000Z' },
      { entityType: 'supplier', entityId: insertedSuppliers[1].id, type: 'email',
        title: 'Yêu cầu báo giá Tokyo Parts', content: 'Request quote for original Panasonic NPM nozzles. Premium quality required.',
        createdAt: '2026-02-01T08:00:00.000Z' },
      { entityType: 'supplier', entityId: insertedSuppliers[2].id, type: 'call',
        title: 'Gọi Dongguan SMT', content: 'Check hàng ASM nozzle 901-series. Ms. Li confirm có stock, giao 5 ngày.',
        createdAt: '2026-01-30T10:00:00.000Z' },

      // Hanwha activities
      { entityType: 'customer', entityId: insertedCustomers[8].id, type: 'order_placed',
        title: 'Hanwha đặt hàng', content: 'Hanwha confirm PO-2025-0004. Samsung nozzles cho HM520 line.',
        createdAt: '2025-12-20T10:30:00.000Z' },

      // Meiko activities
      { entityType: 'customer', entityId: insertedCustomers[5].id, type: 'call',
        title: 'Meiko hỏi về NPM kit', content: 'Mr. Sato gọi hỏi NPM maintenance kit. Budget đã được duyệt. Cần gửi BG.',
        followUpAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), followUpDone: false,
        createdAt: '2026-02-07T11:00:00.000Z' },

      // Amkor activities
      { entityType: 'customer', entityId: insertedCustomers[7].id, type: 'email',
        title: 'Amkor inquiry', content: 'Mr. Lee gửi email hỏi về ASM/Siemens nozzle 1000-series. Cần báo giá.',
        createdAt: '2026-02-04T13:00:00.000Z' },

      // VSIP activities
      { entityType: 'customer', entityId: insertedCustomers[9].id, type: 'call',
        title: 'VSIP hỏi giá nozzle Fuji', content: 'Ông Minh gọi hỏi giá nozzle Fuji NXT. Số lượng nhỏ ~20 cái. Gửi giá qua Zalo.',
        createdAt: '2025-12-22T09:30:00.000Z' },

      // Hanel PT
      { entityType: 'customer', entityId: insertedCustomers[10].id, type: 'zalo',
        title: 'Hanel hỏi nozzle Casio', content: 'Ông Đức Anh nhắn Zalo. Cần nozzle Casio YCM-7000 gấp. Kiểm tra tồn kho.',
        createdAt: '2026-01-12T16:00:00.000Z' },

      // Pipeline activities
      { entityType: 'pipeline', entityId: 1, type: 'note',
        title: 'Update deal Samsung 2026', content: 'Samsung đã ký annual contract. Deal value 800tr. Renewed from 2025.',
        createdAt: '2025-12-28T15:00:00.000Z' },
    ]

    for (const a of activityData) {
      await db.insert(activities).values(a)
    }
    console.log(`✅ Created ${activityData.length} activities`)

    // ═══════════════ SUMMARY ═══════════════
    console.log('')
    console.log('🎉 Comprehensive test data seeding complete!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`  Customers:   ${insertedCustomers.length}`)
    console.log(`  Suppliers:   ${insertedSuppliers.length}`)
    console.log(`  Quotations:  ${insertedQuotations.length}`)
    console.log(`  Orders:      ${insertedOrders.length}`)
    console.log(`  Pipeline:    ${pipelineData.length}`)
    console.log(`  Activities:  ${activityData.length}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  } catch (error) {
    console.error('❌ Error seeding test data:', error)
    throw error
  }
}

seedTestData()
  .then(() => {
    console.log('✅ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })
