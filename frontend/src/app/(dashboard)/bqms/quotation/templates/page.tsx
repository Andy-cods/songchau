'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Upload, FileSpreadsheet, Trash2, Star, Loader2 } from 'lucide-react';

interface Template {
  id: number;
  name: string;
  description: string | null;
  template_type: string;
  file_path: string;
  is_default: boolean;
  created_at: string;
}

const TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  cam_ket: { label: 'Cam kết', cls: 'bg-blue-100 text-blue-700' },
  commercial: { label: 'Thương mại', cls: 'bg-amber-100 text-amber-700' },
  combined: { label: 'Kết hợp', cls: 'bg-purple-100 text-purple-700' },
};

export default function QuotationTemplatesPage() {
  const queryClient = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);

  const { data, isLoading } = useQuery<{ data: Template[] }>({
    queryKey: ['quotation-templates'],
    queryFn: () => api.get('/api/v1/quotations/templates'),
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/quotations/templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quotation-templates'] }),
  });

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => api.upload('/api/v1/quotations/templates', formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotation-templates'] });
      setShowUpload(false);
    },
  });

  const handleUpload = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    uploadMutation.mutate(formData);
  };

  const templates = data?.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Quản Lý Template</h2>
          <p className="text-sm text-slate-500 mt-0.5">Upload và quản lý template Excel cho báo giá</p>
        </div>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Upload className="h-4 w-4" />Upload template
        </button>
      </div>

      {/* Upload Form */}
      {showUpload && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tên template</label>
                <input name="name" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="VD: Template Cam Kết v2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Loại</label>
                <select name="template_type" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  <option value="cam_ket">Cam kết</option>
                  <option value="commercial">Thương mại</option>
                  <option value="combined">Kết hợp</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Mô tả</label>
              <input name="description" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="Mô tả ngắn về template..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">File Excel</label>
              <input name="file" type="file" accept=".xlsx,.xls" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <input name="is_default" type="checkbox" id="is_default" value="true" className="rounded" />
              <label htmlFor="is_default" className="text-sm text-slate-600">Đặt làm mặc định</label>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={uploadMutation.isPending} className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {uploadMutation.isPending ? <><Loader2 className="h-4 w-4 inline animate-spin mr-1" />Đang upload...</> : 'Upload'}
              </button>
              <button type="button" onClick={() => setShowUpload(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Hủy</button>
            </div>
          </form>
        </div>
      )}

      {/* Templates List */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Đang tải...</div>
        ) : templates.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            Chưa có template nào
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {templates.map((tpl) => {
              const type = TYPE_LABELS[tpl.template_type] || TYPE_LABELS.commercial;
              return (
                <div key={tpl.id} className="flex items-center justify-between px-4 py-4 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <FileSpreadsheet className="h-8 w-8 text-green-600" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{tpl.name}</span>
                        {tpl.is_default && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />}
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${type.cls}`}>{type.label}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{tpl.description || 'Không có mô tả'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{new Date(tpl.created_at).toLocaleDateString('vi-VN')}</span>
                    <button
                      onClick={() => { if (confirm('Xóa template này?')) deleteMutation.mutate(tpl.id); }}
                      className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
