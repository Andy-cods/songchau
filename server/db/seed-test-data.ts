import { db } from './index.js'
import { customers, suppliers, activities } from './schema.js'

async function seedTestData() {
  console.log('🌱 Seeding test data...')

  try {
    // Test Customer: Samsung Display, FDI-Korea, KCN Yên Phong, Tier A
    const [testCustomer] = await db
      .insert(customers)
      .values({
        companyName: 'Samsung Display Vietnam',
        companyNameLocal: 'Samsung Display Việt Nam',
        type: 'fdi_korea',
        industry: 'electronics',
        industrialZone: 'KCN Yên Phong (Bắc Ninh)',
        province: 'Bắc Ninh',
        address: 'Khu công nghiệp Yên Phong, Bắc Ninh',
        contactName: 'Mr. Kim Jong-soo',
        contactTitle: 'Purchasing Manager',
        contactPhone: '0912345678',
        contactEmail: 'kim.jongsoo@samsung.com',
        smtBrands: JSON.stringify(['Samsung', 'Panasonic', 'Fuji']),
        smtModels: 'SM481, SM471, NPM-W2',
        purchaseFrequency: 'monthly',
        estimatedAnnualValue: 5000000000,
        paymentTerms: 'net30',
        tier: 'A',
        status: 'active',
        source: 'direct',
        notes: 'Large volume customer, high priority. Monthly nozzle orders.',
      })
      .returning()

    console.log('✅ Created test customer: Samsung Display Vietnam')

    // Test Supplier: Shenzhen Nozzle Co., China, Alibaba, 4 stars
    const [testSupplier] = await db
      .insert(suppliers)
      .values({
        companyName: 'Shenzhen Nozzle Co., Ltd',
        companyNameLocal: '深圳市喷嘴有限公司',
        country: 'china',
        contactName: 'Mr. Zhang Wei',
        contactPhone: '+86 755 1234 5678',
        contactEmail: 'sales@sz-nozzle.com',
        contactWechat: 'sz_nozzle_sales',
        platform: 'alibaba',
        platformUrl: 'https://sz-nozzle.en.alibaba.com',
        rating: 4,
        qualityScore: 8,
        deliveryScore: 7,
        priceScore: 9,
        speciality: JSON.stringify(['Fuji Nozzles', 'Panasonic Nozzles', 'Yamaha Nozzles']),
        brands: JSON.stringify(['Fuji', 'Panasonic', 'Yamaha']),
        minOrderValue: 500,
        leadTimeDays: 7,
        paymentMethods: JSON.stringify(['T/T', 'Alibaba Trade Assurance']),
        status: 'active',
        notes: 'Good supplier for Fuji nozzles. Fast delivery, competitive prices.',
      })
      .returning()

    console.log('✅ Created test supplier: Shenzhen Nozzle Co., Ltd')

    // Test Activity: "Gọi điện hỏi thăm, cần báo giá nozzle Fuji NXT"
    await db.insert(activities).values({
      entityType: 'customer',
      entityId: testCustomer.id,
      type: 'call',
      title: 'Gọi điện hỏi thăm',
      content:
        'Gọi điện cho Mr. Kim. Khách hàng đang cần báo giá nozzle Fuji NXT mô hình H08 và H12. Số lượng khoảng 50 cái mỗi loại. Yêu cầu gửi báo giá trước ngày 15/02.',
      followUpAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
      followUpDone: false,
    })

    console.log('✅ Created test activity for Samsung Display')

    console.log('🎉 Test data seeding complete!')
    console.log('')
    console.log('Test data created:')
    console.log('- Customer: Samsung Display Vietnam (FDI-Korea, Tier A)')
    console.log('- Supplier: Shenzhen Nozzle Co., Ltd (China, 4 stars, Alibaba)')
    console.log('- Activity: Call log with follow-up reminder')
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
