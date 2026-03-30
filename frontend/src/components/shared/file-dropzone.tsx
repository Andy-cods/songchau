'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, X, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileDropzoneProps {
  accept?: string;
  maxSize?: number;
  onFilesSelected: (files: File[]) => void;
  className?: string;
}

export function FileDropzone({
  accept = '.pdf,.xlsx,.xls,.csv',
  maxSize = 50 * 1024 * 1024,
  onFilesSelected,
  className,
}: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError('');
    const file = files[0];
    if (file.size > maxSize) {
      setError(`File quá lớn. Tối đa ${Math.round(maxSize / 1024 / 1024)}MB`);
      return;
    }
    setSelectedFile(file);
    onFilesSelected([file]);
  }, [maxSize, onFilesSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const clear = () => {
    setSelectedFile(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer',
        isDragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-slate-400',
        className,
      )}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {selectedFile ? (
        <div className="flex items-center justify-center gap-3">
          <FileText className="h-8 w-8 text-brand-500" />
          <div className="text-left">
            <p className="text-sm font-medium text-slate-700">{selectedFile.name}</p>
            <p className="text-xs text-slate-500">{(selectedFile.size / 1024).toFixed(0)} KB</p>
          </div>
          <button onClick={(e) => { e.stopPropagation(); clear(); }} className="p-1 hover:bg-slate-100 rounded">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>
      ) : (
        <>
          <Upload className="h-10 w-10 text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-600">
            Kéo thả file vào đây hoặc{' '}
            <span className="text-brand-600 font-medium">Chọn file</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {accept.replace(/\./g, '').toUpperCase()} — Tối đa {Math.round(maxSize / 1024 / 1024)}MB
          </p>
        </>
      )}

      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
