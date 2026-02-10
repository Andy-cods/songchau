import { Hono } from 'hono'
import { db } from '../db'
import { settings } from '../db/schema'
import { eq } from 'drizzle-orm'
import * as fs from 'fs'
import * as path from 'path'

const app = new Hono()

// Get all settings
app.get('/', async (c) => {
  try {
    const allSettings = await db.select().from(settings)

    // Convert array to object for easier frontend access
    const settingsObject: Record<string, string> = {}
    allSettings.forEach((setting) => {
      settingsObject[setting.key] = setting.value || ''
    })

    // Provide defaults if settings don't exist
    const defaults = {
      companyName: 'Song Châu Co., Ltd',
      companyNameLocal: 'Công Ty TNHH Một thành viên Song Châu',
      companyAddress: 'Zone 4, Tien Chau Ward, Phuc Yen City, Vinh Phuc Province',
      companyTaxCode: '2500574479',
      companyEmail: 'songchaucompanyltd@gmail.com',
      companyPhone: '0985145533',
      defaultCurrency: 'VND',
      usdToVnd: '25000',
      cnyToVnd: '3500',
      jpyToVnd: '170',
      taxRate: '10',
      quoteNumberPrefix: 'SC-Q',
      orderNumberPrefix: 'SC-PO',
    }

    return c.json({ settings: { ...defaults, ...settingsObject } })
  } catch (error) {
    console.error('Error fetching settings:', error)
    return c.json({ error: 'Failed to fetch settings' }, 500)
  }
})

// Update settings
app.put('/', async (c) => {
  try {
    const body = await c.req.json()
    const { settings: settingsToUpdate } = body

    if (!settingsToUpdate || typeof settingsToUpdate !== 'object') {
      return c.json({ error: 'Invalid settings data' }, 400)
    }

    // Update or insert each setting
    for (const [key, value] of Object.entries(settingsToUpdate)) {
      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key))
        .limit(1)

      if (existing.length > 0) {
        await db
          .update(settings)
          .set({ value: String(value), updatedAt: new Date().toISOString() })
          .where(eq(settings.key, key))
      } else {
        await db.insert(settings).values({
          key,
          value: String(value),
          updatedAt: new Date().toISOString(),
        })
      }
    }

    return c.json({ success: true, message: 'Settings updated successfully' })
  } catch (error) {
    console.error('Error updating settings:', error)
    return c.json({ error: 'Failed to update settings' }, 500)
  }
})

// Backup database
app.post('/backup', async (c) => {
  try {
    const dbPath = path.join(process.cwd(), 'data', 'songchau.db')

    // Check if database file exists
    if (!fs.existsSync(dbPath)) {
      return c.json({ error: 'Database file not found' }, 404)
    }

    // Read the database file
    const dbBuffer = fs.readFileSync(dbPath)

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0]
    const filename = `songchau-crm-backup-${timestamp}.db`

    // Return the file as a download
    return c.body(dbBuffer, 200, {
      'Content-Type': 'application/x-sqlite3',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': dbBuffer.length.toString(),
    })
  } catch (error) {
    console.error('Error backing up database:', error)
    return c.json({ error: 'Failed to backup database' }, 500)
  }
})

export default app
