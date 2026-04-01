import { api } from '@/lib/api';

// Samsung Sync (M04)
export const triggerSamsungSync = (params: any) => api.post('/api/v1/samsung-sync/trigger', params);
export const getSyncStatus = () => api.get('/api/v1/samsung-sync/status');
export const confirmPO = (poNumber: string) => api.post(`/api/v1/samsung-sync/confirm-po/${poNumber}`);
export const acceptPO = (poNumber: string) => api.post(`/api/v1/samsung-sync/accept-po/${poNumber}`);

// Market Prices (M05)
export const getMarketPrices = (params?: string) => api.get(`/api/v1/market-prices${params ? '?' + params : ''}`);
export const compareMarketPrices = (bqmsCode: string) => api.get(`/api/v1/market-prices/compare?bqms_code=${bqmsCode}`);
export const searchMarketPrice = (data: any) => api.post('/api/v1/market-prices/search', data);
export const getMarketStats = () => api.get('/api/v1/market-prices/stats');

// Samsung Watchdog (M06)
export const getWatchdogStatus = () => api.get('/api/v1/watchdog/status');
export const getWatchdogEvents = () => api.get('/api/v1/watchdog/events');
export const processWatchdogEvent = (id: number) => api.post(`/api/v1/watchdog/events/${id}/process`);

// Supplier Scoring (M07)
export const getSupplierRanking = () => api.get('/api/v1/supplier-scoring/ranking');
export const getSupplierScore = (id: number) => api.get(`/api/v1/supplier-scoring/${id}`);
export const recalculateScores = () => api.post('/api/v1/supplier-scoring/recalculate');

// Delivery Tracking (M09)
export const getDeliverySchedule = () => api.get('/api/v1/delivery-tracking/schedule');
export const getDeliveryAlerts = () => api.get('/api/v1/delivery-tracking/alerts');
export const getDeliveryDetail = (id: number) => api.get(`/api/v1/delivery-tracking/${id}`);
