import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { type Quotation } from '@/lib/api'
import { format } from 'date-fns'

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1e293b',
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
    borderBottom: '2px solid #2563eb',
    paddingBottom: 15,
  },
  companyName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#2563eb',
  },
  companyNameVN: {
    fontSize: 9,
    color: '#64748b',
    marginTop: 2,
  },
  companyDetail: {
    fontSize: 8,
    color: '#64748b',
    marginTop: 1,
  },
  quoteTitle: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    textAlign: 'right',
  },
  quoteTitleVN: {
    fontSize: 10,
    color: '#64748b',
    textAlign: 'right',
    marginTop: 2,
  },
  quoteNumber: {
    fontSize: 11,
    color: '#2563eb',
    textAlign: 'right',
    marginTop: 4,
    fontFamily: 'Helvetica-Bold',
  },
  // Info section
  infoSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 25,
  },
  infoBlock: {
    width: '48%',
  },
  infoLabel: {
    fontSize: 8,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 10,
    color: '#1e293b',
    marginBottom: 2,
  },
  infoBold: {
    fontFamily: 'Helvetica-Bold',
  },
  // Table
  table: {
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#2563eb',
    padding: '8 10',
    borderRadius: 3,
  },
  tableHeaderText: {
    color: '#ffffff',
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '1px solid #e2e8f0',
    padding: '7 10',
  },
  tableRowAlt: {
    backgroundColor: '#f8fafc',
  },
  colNo: { width: '6%' },
  colPart: { width: '20%' },
  colName: { width: '30%' },
  colQty: { width: '10%', textAlign: 'right' },
  colPrice: { width: '17%', textAlign: 'right' },
  colAmount: { width: '17%', textAlign: 'right' },
  cellText: {
    fontSize: 9,
    color: '#334155',
  },
  cellMono: {
    fontSize: 9,
    fontFamily: 'Courier',
    color: '#2563eb',
  },
  // Totals
  totalsSection: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 25,
  },
  totalsBox: {
    width: 220,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: '4 0',
  },
  totalsDivider: {
    borderTop: '1.5px solid #2563eb',
    marginTop: 4,
    paddingTop: 6,
  },
  totalsLabel: {
    fontSize: 9,
    color: '#64748b',
  },
  totalsValue: {
    fontSize: 9,
    color: '#1e293b',
    fontFamily: 'Helvetica-Bold',
  },
  grandTotalLabel: {
    fontSize: 11,
    color: '#1e293b',
    fontFamily: 'Helvetica-Bold',
  },
  grandTotalValue: {
    fontSize: 12,
    color: '#2563eb',
    fontFamily: 'Helvetica-Bold',
  },
  // Notes
  notesSection: {
    marginBottom: 30,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    border: '1px solid #e2e8f0',
  },
  notesTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  notesText: {
    fontSize: 9,
    color: '#475569',
    lineHeight: 1.4,
  },
  // Footer
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 40,
    paddingTop: 15,
    borderTop: '1px solid #e2e8f0',
  },
  signBlock: {
    width: '45%',
    alignItems: 'center',
  },
  signLabel: {
    fontSize: 9,
    color: '#64748b',
    marginBottom: 40,
  },
  signLine: {
    width: '80%',
    borderBottom: '1px solid #94a3b8',
  },
  // Watermark
  watermark: {
    position: 'absolute',
    top: '45%',
    left: '25%',
    fontSize: 60,
    color: '#e2e8f0',
    fontFamily: 'Helvetica-Bold',
    transform: 'rotate(-30deg)',
    opacity: 0.3,
  },
})

const formatNumber = (n: number | null | undefined) =>
  n != null ? new Intl.NumberFormat('vi-VN').format(n) : '—'

interface QuotationPDFProps {
  quotation: Quotation
}

export default function QuotationPDF({ quotation }: QuotationPDFProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Draft watermark */}
        {quotation.status === 'draft' && <Text style={styles.watermark}>DRAFT</Text>}

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>SONG CHAU CO., LTD</Text>
            <Text style={styles.companyNameVN}>Công Ty TNHH Một Thành Viên Song Châu</Text>
            <Text style={styles.companyDetail}>Zone 4, Tien Chau Ward, Phuc Yen City, Vinh Phuc</Text>
            <Text style={styles.companyDetail}>Tax Code: 2500574479</Text>
            <Text style={styles.companyDetail}>Tel: 0985 145 533 | Email: songchaucompanyltd@gmail.com</Text>
          </View>
          <View>
            <Text style={styles.quoteTitle}>QUOTATION</Text>
            <Text style={styles.quoteTitleVN}>BÁO GIÁ</Text>
            <Text style={styles.quoteNumber}>{quotation.quoteNumber}</Text>
          </View>
        </View>

        {/* Customer & Quote Info */}
        <View style={styles.infoSection}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Bill To / Khách hàng</Text>
            <Text style={[styles.infoValue, styles.infoBold]}>{quotation.customerName}</Text>
            {quotation.customerContact && <Text style={styles.infoValue}>{quotation.customerContact}</Text>}
            {quotation.customerAddress && <Text style={styles.infoValue}>{quotation.customerAddress}</Text>}
            {quotation.customerPhone && <Text style={styles.infoValue}>Tel: {quotation.customerPhone}</Text>}
            {quotation.customerEmail && <Text style={styles.infoValue}>Email: {quotation.customerEmail}</Text>}
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Quote Details / Chi tiết</Text>
            <Text style={styles.infoValue}>
              Date / Ngày: {format(new Date(quotation.createdAt), 'dd/MM/yyyy')}
            </Text>
            <Text style={styles.infoValue}>
              Valid Until / Hiệu lực:{' '}
              {quotation.validUntil ? format(new Date(quotation.validUntil), 'dd/MM/yyyy') : '—'}
            </Text>
            <Text style={styles.infoValue}>Currency / Tiền tệ: {quotation.currency}</Text>
          </View>
        </View>

        {/* Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, styles.colNo]}>No</Text>
            <Text style={[styles.tableHeaderText, styles.colPart]}>Part No.</Text>
            <Text style={[styles.tableHeaderText, styles.colName]}>Description</Text>
            <Text style={[styles.tableHeaderText, styles.colQty]}>Qty</Text>
            <Text style={[styles.tableHeaderText, styles.colPrice]}>Unit Price</Text>
            <Text style={[styles.tableHeaderText, styles.colAmount]}>Amount</Text>
          </View>
          {quotation.items?.map((item, idx) => (
            <View
              key={item.id || idx}
              style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
            >
              <Text style={[styles.cellText, styles.colNo]}>{idx + 1}</Text>
              <Text style={[styles.cellMono, styles.colPart]}>{item.productPartNumber}</Text>
              <Text style={[styles.cellText, styles.colName]}>{item.productName}</Text>
              <Text style={[styles.cellText, styles.colQty]}>{item.quantity}</Text>
              <Text style={[styles.cellText, styles.colPrice]}>{formatNumber(item.unitPrice)}</Text>
              <Text style={[styles.cellText, styles.colAmount]}>{formatNumber(item.amount)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal / Tạm tính</Text>
              <Text style={styles.totalsValue}>{formatNumber(quotation.subtotal)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>VAT ({quotation.taxRate}%)</Text>
              <Text style={styles.totalsValue}>{formatNumber(quotation.taxAmount)}</Text>
            </View>
            <View style={[styles.totalsRow, styles.totalsDivider]}>
              <Text style={styles.grandTotalLabel}>Total / Tổng cộng</Text>
              <Text style={styles.grandTotalValue}>
                {formatNumber(quotation.totalAmount)} {quotation.currency}
              </Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {quotation.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesTitle}>Terms & Conditions / Điều khoản</Text>
            <Text style={styles.notesText}>{quotation.notes}</Text>
          </View>
        )}

        {/* Signatures */}
        <View style={styles.footer}>
          <View style={styles.signBlock}>
            <Text style={styles.signLabel}>Seller / Bên bán</Text>
            <View style={styles.signLine} />
          </View>
          <View style={styles.signBlock}>
            <Text style={styles.signLabel}>Buyer / Bên mua</Text>
            <View style={styles.signLine} />
          </View>
        </View>
      </Page>
    </Document>
  )
}
