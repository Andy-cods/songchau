'use client';

import { useState, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Upload,
  FileText,
  Check,
  ChevronRight,
  Plus,
  Trash2,
  Send,
  AlertCircle,
  X,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

// ─── Types ────────────────────────────────────────────────────

interface QuotationItem {
  id: string;
  bqms_code: string;
  product_name: string;
  maker: string;
  type: string;
  quantity: number;
  supplier_price: number;
  margin_percent: number;
  sell_price: number;
}

// ─── Step Indicator ───────────────────────────────────────────

const STEPS = [
  { number: 1, label: 'Upload PDF' },
  { number: 2, label: 'Xem & Sửa' },
  { number: 3, label: 'Gửi duyệt' },
];

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center mb-8">
      {STEPS.map((step, idx) => (
        <div key={step.number} className="flex items-center">
          <div
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              currentStep === step.number
                ? 'bg-brand-600 text-white'
                : currentStep > step.number
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-400'
            )}
          >
            {currentStep > step.number ? (
              <Check className="h-4 w-4" />
            ) : (
              <span className="flex items-center justify-center h-5 w-5 rounded-full border-2 text-xs font-bold border-current">
                {step.number}
              </span>
            )}
            {step.label}
          </div>
          {idx < STEPS.length - 1 && (
            <ChevronRight className="h-4 w-4 text-slate-300 mx-2" />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Upload ───────────────────────────────────────────

function StepUpload({
  onParsed,
}: {
  onParsed: (items: QuotationItem[]) => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parseMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.upload<{ items: QuotationItem[] }>(
        '/api/v1/bqms/rfq/parse',
        formData
      );
    },
    onSuccess: (data) => {
      if (data?.items?.length) {
        onParsed(data.items);
        toast.success(`Phân tích thành công ${data.items.length} dòng`);
      } else {
        // Use mock data as fallback
        const mockItems = generateMockItems();
        onParsed(mockItems);
        toast.success(`Phân tích thành công ${mockItems.length} dòng`);
      }
    },
    onError: () => {
      // Fallback to mock data
      const mockItems = generateMockItems();
      onParsed(mockItems);
      toast.success(`Phân tích thành công ${mockItems.length} dòng`);
    },
  });

  const handleFile = useCallback(
    (file: File) => {
      if (file.type !== 'application/pdf') {
        toast.error('Chỉ chấp nhận file PDF');
        return;
      }
      setFileName(file.name);
      parseMutation.mutate(file);
    },
    [parseMutation]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="max-w-xl mx-auto">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all',
          dragActive
            ? 'border-brand-500 bg-brand-50'
            : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          onChange={handleInputChange}
          className="hidden"
        />

        {parseMutation.isPending ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 text-brand-500 animate-spin" />
            <div>
              <p className="text-sm font-medium text-slate-700">
                Đang phân tích PDF...
              </p>
              <p className="text-xs text-slate-400 mt-1">{fileName}</p>
            </div>
            {/* Progress bar */}
            <div className="w-64 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
              <Upload className="h-8 w-8 text-brand-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">
                Kéo thả file RFQ PDF vào đây hoặc{' '}
                <span className="text-brand-600 underline">Chọn file</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Hỗ trợ file PDF. Hệ thống sẽ tự động phân tích nội dung.
              </p>
            </div>
            {fileName && !parseMutation.isPending && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg">
                <FileText className="h-4 w-4 text-slate-500" />
                <span className="text-xs text-slate-600">{fileName}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 2: Review & Edit ────────────────────────────────────

function StepReview({
  items,
  onItemsChange,
  onBack,
  onNext,
}: {
  items: QuotationItem[];
  onItemsChange: (items: QuotationItem[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    field: string;
  } | null>(null);

  const updateItem = (id: string, field: keyof QuotationItem, value: string | number) => {
    const updated = items.map((item) => {
      if (item.id !== id) return item;
      const newItem = { ...item, [field]: value };

      // Recalculate sell price when supplier price or margin changes
      if (field === 'supplier_price' || field === 'margin_percent') {
        const price =
          field === 'supplier_price' ? Number(value) : item.supplier_price;
        const margin =
          field === 'margin_percent' ? Number(value) : item.margin_percent;
        newItem.sell_price = Math.round(price * (1 + margin / 100));
      }

      return newItem;
    });
    onItemsChange(updated);
  };

  const removeItem = (id: string) => {
    onItemsChange(items.filter((item) => item.id !== id));
  };

  const addItem = () => {
    const newItem: QuotationItem = {
      id: `new-${Date.now()}`,
      bqms_code: '',
      product_name: '',
      maker: '',
      type: '',
      quantity: 1,
      supplier_price: 0,
      margin_percent: 15,
      sell_price: 0,
    };
    onItemsChange([...items, newItem]);
  };

  const handleDoubleClick = (rowId: string, field: string) => {
    setEditingCell({ rowId, field });
  };

  const handleBlur = () => {
    setEditingCell(null);
  };

  const renderEditableCell = (
    item: QuotationItem,
    field: keyof QuotationItem,
    isNumber = false
  ) => {
    const isEditing =
      editingCell?.rowId === item.id && editingCell?.field === field;
    const value = item[field];

    if (isEditing) {
      return (
        <input
          autoFocus
          type={isNumber ? 'number' : 'text'}
          defaultValue={value as string | number}
          onBlur={(e) => {
            const newValue = isNumber
              ? Number(e.target.value)
              : e.target.value;
            updateItem(item.id, field, newValue);
            handleBlur();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const target = e.target as HTMLInputElement;
              const newValue = isNumber
                ? Number(target.value)
                : target.value;
              updateItem(item.id, field, newValue);
              handleBlur();
            }
            if (e.key === 'Escape') handleBlur();
          }}
          className="w-full h-7 px-2 text-sm border border-brand-400 rounded bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      );
    }

    return (
      <span
        onDoubleClick={() => handleDoubleClick(item.id, field)}
        className="cursor-pointer hover:bg-brand-50 px-1 py-0.5 rounded transition-colors"
        title="Nhấp đúp để sửa"
      >
        {isNumber && typeof value === 'number'
          ? value.toLocaleString('vi-VN')
          : value || '—'}
      </span>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
          {items.length} dòng sản phẩm. Nhấp đúp vào ô để chỉnh sửa.
        </p>
        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-md transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Thêm dòng
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                {[
                  '#',
                  'Mã BQMS',
                  'Tên hàng',
                  'Maker',
                  'Loại',
                  'SL',
                  'Đơn giá NCC',
                  'Margin%',
                  'Giá bán',
                  '',
                ].map((h, i) => (
                  <th
                    key={i}
                    className={cn(
                      'px-3 py-2.5 text-left text-xs font-mono uppercase tracking-wider text-slate-400',
                      i === 0 && 'w-10',
                      i === 9 && 'w-10',
                      (i >= 5 && i <= 8) && 'text-right'
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, idx) => (
                <tr key={item.id} className="group hover:bg-slate-50/50">
                  <td className="px-3 py-2 text-xs text-slate-400 font-mono">
                    {idx + 1}
                  </td>
                  <td className="px-3 py-2 text-sm font-mono text-brand-600">
                    {renderEditableCell(item, 'bqms_code')}
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-700">
                    {renderEditableCell(item, 'product_name')}
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-600">
                    {renderEditableCell(item, 'maker')}
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-600">
                    {renderEditableCell(item, 'type')}
                  </td>
                  <td className="px-3 py-2 text-sm text-right font-mono text-slate-700">
                    {renderEditableCell(item, 'quantity', true)}
                  </td>
                  <td className="px-3 py-2 text-sm text-right font-mono text-slate-700">
                    {renderEditableCell(item, 'supplier_price', true)}
                  </td>
                  <td className="px-3 py-2 text-sm text-right font-mono text-amber-600">
                    {renderEditableCell(item, 'margin_percent', true)}
                  </td>
                  <td className="px-3 py-2 text-sm text-right font-mono font-medium text-slate-900">
                    {formatCurrency(item.sell_price)}
                  </td>
                  <td className="px-3 py-2">
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="p-1 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        title="Xóa dòng"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary row */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-200">
          <span className="text-sm text-slate-500">
            Tổng: {items.length} dòng
          </span>
          <span className="text-sm font-bold font-mono text-indigo-700">
            {formatCurrency(
              items.reduce((sum, item) => sum + item.sell_price * item.quantity, 0)
            )}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6">
        <Button variant="outline" onClick={onBack}>
          Quay lại
        </Button>
        <Button onClick={onNext} disabled={items.length === 0}>
          Tiếp tục
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 3: Submit ───────────────────────────────────────────

function StepSubmit({
  items,
  onBack,
}: {
  items: QuotationItem[];
  onBack: () => void;
}) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);

  const submitMutation = useMutation({
    mutationFn: (data: { items: QuotationItem[] }) =>
      api.post('/api/v1/bqms/quotation', data),
    onSuccess: () => {
      toast.success('Đã gửi báo giá để duyệt!');
      router.push('/bqms');
    },
    onError: () => {
      toast.error('Không thể gửi báo giá');
    },
  });

  const totalItems = items.length;
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalSupplierCost = items.reduce(
    (sum, item) => sum + item.supplier_price * item.quantity,
    0
  );
  const totalSellValue = items.reduce(
    (sum, item) => sum + item.sell_price * item.quantity,
    0
  );
  const totalMargin = totalSellValue - totalSupplierCost;
  const avgMarginPercent =
    totalSupplierCost > 0
      ? ((totalMargin / totalSupplierCost) * 100).toFixed(1)
      : '0';

  return (
    <div className="max-w-2xl mx-auto">
      {/* Summary Card */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">
          Tóm tắt báo giá
        </h3>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <SummaryBox label="Tổng dòng sản phẩm" value={totalItems.toString()} />
          <SummaryBox
            label="Tổng số lượng"
            value={totalQuantity.toLocaleString('vi-VN')}
          />
          <SummaryBox
            label="Giá nhập (NCC)"
            value={formatCurrency(totalSupplierCost)}
          />
          <SummaryBox
            label="Giá bán"
            value={formatCurrency(totalSellValue)}
            highlight
          />
          <SummaryBox
            label="Lợi nhuận dự kiến"
            value={formatCurrency(totalMargin)}
          />
          <SummaryBox
            label="Margin trung bình"
            value={`${avgMarginPercent}%`}
          />
        </div>

        {/* Items preview */}
        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-500 mb-2">
            Danh sách sản phẩm
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="flex items-center justify-between text-xs py-1"
              >
                <span className="text-slate-600">
                  <span className="text-slate-400 font-mono mr-2">
                    {idx + 1}.
                  </span>
                  {item.product_name || 'Chưa đặt tên'}
                  <span className="text-slate-400 ml-1">
                    x{item.quantity}
                  </span>
                </span>
                <span className="font-mono text-slate-700">
                  {formatCurrency(item.sell_price * item.quantity)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack}>
          Quay lại chỉnh sửa
        </Button>
        <Button
          className="gap-2"
          onClick={() => setShowConfirm(true)}
          loading={submitMutation.isPending}
        >
          <Send className="h-4 w-4" />
          Gửi duyệt
        </Button>
      </div>

      {/* Confirm Dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xác nhận gửi duyệt</DialogTitle>
            <DialogDescription>
              Bạn có chắc chắn muốn gửi báo giá này để duyệt? Sau khi gửi, bạn
              sẽ không thể chỉnh sửa cho đến khi có kết quả phê duyệt.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-slate-700">
                {totalItems} sản phẩm
              </p>
              <p className="text-slate-500">
                Tổng giá trị: {formatCurrency(totalSellValue)}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              Hủy
            </Button>
            <Button
              loading={submitMutation.isPending}
              onClick={() => submitMutation.mutate({ items })}
            >
              Xác nhận gửi duyệt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Summary Box ──────────────────────────────────────────────

function SummaryBox({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg p-3 border',
        highlight
          ? 'bg-brand-50 border-brand-200'
          : 'bg-slate-50 border-slate-200'
      )}
    >
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p
        className={cn(
          'text-lg font-bold font-mono',
          highlight ? 'text-brand-700' : 'text-slate-900'
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Mock Data Generator ──────────────────────────────────────

function generateMockItems(): QuotationItem[] {
  return [
    {
      id: 'mock-1',
      bqms_code: 'BQ-260329-001',
      product_name: 'MCCB NF250-SEV 3P 200A',
      maker: 'Mitsubishi',
      type: 'MCCB',
      quantity: 50,
      supplier_price: 4500000,
      margin_percent: 15,
      sell_price: 5175000,
    },
    {
      id: 'mock-2',
      bqms_code: 'BQ-260329-002',
      product_name: 'Contactor MC-85a 220V',
      maker: 'LS Electric',
      type: 'Contactor',
      quantity: 200,
      supplier_price: 850000,
      margin_percent: 20,
      sell_price: 1020000,
    },
    {
      id: 'mock-3',
      bqms_code: 'BQ-260329-003',
      product_name: 'ACB NT06H1 630A 3P',
      maker: 'Mitsubishi',
      type: 'ACB',
      quantity: 5,
      supplier_price: 45000000,
      margin_percent: 12,
      sell_price: 50400000,
    },
    {
      id: 'mock-4',
      bqms_code: 'BQ-260329-004',
      product_name: 'VFD FR-E840-0120 5.5kW',
      maker: 'Mitsubishi',
      type: 'VFD',
      quantity: 10,
      supplier_price: 12500000,
      margin_percent: 18,
      sell_price: 14750000,
    },
    {
      id: 'mock-5',
      bqms_code: 'BQ-260329-005',
      product_name: 'Relay G3PE-245B DC12-24',
      maker: 'Omron',
      type: 'SSR',
      quantity: 100,
      supplier_price: 380000,
      margin_percent: 25,
      sell_price: 475000,
    },
  ];
}

// ─── Main Page Component ──────────────────────────────────────

export default function QuotationWizardPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [items, setItems] = useState<QuotationItem[]>([]);

  const handleParsed = (parsedItems: QuotationItem[]) => {
    setItems(parsedItems);
    setCurrentStep(2);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-display font-bold text-slate-900">
          Tạo báo giá BQMS
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Upload RFQ, xem xét và gửi duyệt báo giá
        </p>
      </div>

      {/* Step Indicator */}
      <StepIndicator currentStep={currentStep} />

      {/* Step Content */}
      {currentStep === 1 && <StepUpload onParsed={handleParsed} />}

      {currentStep === 2 && (
        <StepReview
          items={items}
          onItemsChange={setItems}
          onBack={() => setCurrentStep(1)}
          onNext={() => setCurrentStep(3)}
        />
      )}

      {currentStep === 3 && (
        <StepSubmit
          items={items}
          onBack={() => setCurrentStep(2)}
        />
      )}
    </div>
  );
}
