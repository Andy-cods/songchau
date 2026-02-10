import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function safeParseJsonArray(value: string | null | undefined): string[] {
  if (!value) return []
  try { return JSON.parse(value) } catch { return value.split(',').map(s => s.trim()) }
}
