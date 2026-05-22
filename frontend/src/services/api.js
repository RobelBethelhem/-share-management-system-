import axios from 'axios';
import { API_BASE } from '../utils/apiBase';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (data) => api.post('/login', data);
export const getProfile = () => api.get('/profile');
export const register = (data) => api.post('/register', data);

// Dashboard
export const getDashboard = () => api.get('/dashboard');

// Shareholders
export const getShareholders = (params) => api.get('/shareholders', { params });
export const getShareholder = (id) => api.get(`/shareholders/${id}`);
export const searchShareholders = (q) => api.get('/shareholders/search', { params: { q } });
export const searchShareholdersAdvanced  = (data) => api.post('/shareholders/search-advanced', data);
export const searchInvestmentsAdvanced   = (data) => api.post('/investments/search-advanced', data);
export const searchSubscriptionsAdvanced = (data) => api.post('/subscriptions/search-advanced', data);
export const searchTransfersAdvanced     = (data) => api.post('/transfers/search-advanced', data);
export const searchShareBlocksAdvanced   = (data) => api.post('/share-blocks/search-advanced', data);
export const searchCertificatesAdvanced  = (data) => api.post('/certificates/search-advanced', data);
export const searchAllocationsAdvanced   = (data) => api.post('/allocations/search-advanced', data);
export const createShareholder = (data) => api.post('/shareholders', data);
export const updateShareholder = (id, data) => api.put(`/shareholders/${id}`, data);
export const deleteShareholder = (id) => api.delete(`/shareholders/${id}`);
export const getShareholderInvestmentSummary = (id) => api.get(`/shareholders/${id}/investment-summary`);

// Subscriptions
export const getSubscriptions = (params) => api.get('/subscriptions', { params });
export const createSubscription = (data) => api.post('/subscriptions', data);
export const updateSubscription = (id, data) => api.put(`/subscriptions/${id}`, data);
export const reverseSubscription = (id) => api.post(`/subscriptions/${id}/reverse`);
export const extendSubscription = (id, data) => api.post(`/subscriptions/${id}/extend`, data);
export const deleteSubscription = (id) => api.delete(`/subscriptions/${id}`);
export const preSubscribe = (data) => api.post('/subscriptions/pre-subscribe', data);

// Allocations
export const getAllocations = (params) => api.get('/allocations', { params });
export const createAllocation = (data) => api.post('/allocations', data);
export const allocateFromSubscriptions = (data) => api.post('/allocations/from-subscriptions', data);

// Capital Increase Share Allocation
export const getCapitalIncreases = (params) => api.get('/capital-increases', { params });
export const getCapitalIncrease = (id) => api.get(`/capital-increases/${id}`);
export const createCapitalIncrease = (data) => api.post('/capital-increases', data);
export const updateCapitalIncrease = (id, data) => api.put(`/capital-increases/${id}`, data);
export const startCapitalIncrease = (id) => api.post(`/capital-increases/${id}/start`);
export const previewCIRound = (id, round) => api.get(`/capital-increases/${id}/rounds/${round}/preview`);
export const runCIRound = (id, round) => api.post(`/capital-increases/${id}/run-round`, { round });
export const confirmCISubscription = (id, subId, data) => api.post(`/capital-increases/${id}/subscriptions/${subId}/confirm`, data || {});
export const reverseCISubscription = (id, subId) => api.post(`/capital-increases/${id}/subscriptions/${subId}/reverse`);
export const closeCIRound = (id, round) => api.post(`/capital-increases/${id}/close-round`, { round });
export const openCIAdditional = (id) => api.post(`/capital-increases/${id}/open-additional`);
export const closeCapitalIncrease = (id) => api.post(`/capital-increases/${id}/close`);
export const deleteCapitalIncrease = (id) => api.delete(`/capital-increases/${id}`);
export const getCISubscriptions = (id, params) => api.get(`/capital-increases/${id}/subscriptions`, { params });
export const getCISummary = (id) => api.get(`/capital-increases/${id}/summary`);
export const getCIAdditionalRequests = (id) => api.get(`/capital-increases/${id}/additional-requests`);
export const listAllCIAdditionalRequests = (params) => api.get('/ci-additional-requests', { params });
export const createCIAdditionalRequest = (id, data) => api.post(`/capital-increases/${id}/additional-requests`, data);
export const approveCIAdditionalRequest = (id, reqId, data) => api.post(`/capital-increases/${id}/additional-requests/${reqId}/approve`, data);
export const rejectCIAdditionalRequest = (id, reqId) => api.post(`/capital-increases/${id}/additional-requests/${reqId}/reject`);

// Investments
export const getInvestments = (params) => api.get('/investments', { params });
export const getInvestment = (id) => api.get(`/investments/${id}`);
export const createInvestment = (data) => api.post('/investments', data);
export const updateInvestment = (id, data) => api.put(`/investments/${id}`, data);

// Transfers
export const getTransfers = (params) => api.get('/transfers', { params });
export const getTransfer = (id) => api.get(`/transfers/${id}`);
export const createTransfer = (data) => api.post('/transfers', data);
export const approveTransfer = (id) => api.post(`/transfers/${id}/approve`);
export const rejectTransfer = (id, data) => api.post(`/transfers/${id}/reject`, data);
export const calculateTransferFees = (data) => api.post('/transfers/calculate-fees', data);

// Dividend Settings
export const getDividendSettings = () => api.get('/dividend-settings');
export const createDividendSetting = (data) => api.post('/dividend-settings', data);
export const updateDividendSetting = (id, data) => api.put(`/dividend-settings/${id}`, data);
export const processDividend = (id) => api.post(`/dividend-settings/${id}/process`);
export const deleteDividendSetting = (id) => api.delete(`/dividend-settings/${id}`);
export const getDPSSummary = () => api.get('/dividend-settings/dps-summary');

// Dividends
export const getDividends = (params) => api.get('/dividends', { params });
export const collectDividend = (id, data) => api.post(`/dividends/${id}/collect`, data);
export const blockDividend = (id, data) => api.post(`/dividends/${id}/block`, data);
export const releaseDividend = (id) => api.post(`/dividends/${id}/release`);
export const transferDividend = (id, data) => api.post(`/dividends/${id}/transfer`, data);
export const returnDividendTax = (id) => api.post(`/dividends/${id}/tax-return`);
export const returnDividendPayment = (id) => api.post(`/dividends/${id}/payment-return`);
export const reinvestDividend = (id, data) => api.post(`/dividends/${id}/reinvest`, data);
export const getDividendBreakdown = (id) => api.get(`/dividends/${id}/breakdown`);
export const getDividendHistory = (id) => api.get(`/dividends/${id}/history`);

// Dividend Tax Schedules
export const getDividendTaxSchedules = () => api.get('/dividend-tax-schedules');
export const updateDividendTaxSchedules = (data) => api.put('/dividend-tax-schedules', data);
export const createDividendTaxBracket = (data) => api.post('/dividend-tax-schedules', data);
export const updateDividendTaxBracket = (id, data) => api.put(`/dividend-tax-schedules/${id}`, data);
export const deleteDividendTaxBracket = (id) => api.delete(`/dividend-tax-schedules/${id}`);

// System Settings
export const getSystemSettings = () => api.get('/system-settings');
export const getSystemSetting = (key) => api.get(`/system-settings/${key}`);
export const createSystemSetting = (data) => api.post('/system-settings', data);
export const updateSystemSetting = (key, data) => api.put(`/system-settings/${key}`, data);
export const deleteSystemSetting = (key) => api.delete(`/system-settings/${key}`);
export const testFormula = (data) => api.post('/system-settings/test-formula', data);

// Bank Capital
export const getBankCapital = () => api.get('/bank-capital');
export const updateBankCapital = (data) => api.put('/bank-capital', data);

// Share Splits
export const getShareSplits = () => api.get('/share-splits');
export const createShareSplit = (data) => api.post('/share-splits', data);
export const updateShareSplit = (id, data) => api.put(`/share-splits/${id}`, data);
export const processShareSplit = (id) => api.post(`/share-splits/${id}/process`);

// Share Blocks
export const getShareBlocks = (params) => api.get('/share-blocks', { params });
export const getShareBlock = (id) => api.get(`/share-blocks/${id}`);
export const createShareBlock = (data) => api.post('/share-blocks', data);
export const releaseShareBlock = (id) => api.post(`/share-blocks/${id}/release`);

// Certificates
export const getCertificates = (params) => api.get('/certificates', { params });
export const getCertificate = (id) => api.get(`/certificates/${id}`);
export const getNextCertNo = () => api.get('/certificates/next-no');
export const createCertificate = (data) => api.post('/certificates', data);
export const updateCertificate = (id, data) => api.put(`/certificates/${id}`, data);
export const printCertificate = (id) => api.post(`/certificates/${id}/print`);

// AGM
export const getAGMAttendance = (params) => api.get('/agm-attendance', { params });
export const createAGMAttendance = (data) => api.post('/agm-attendance', data);

// Approvals
export const getApprovals = (params) => api.get('/approvals', { params });
export const approveItem = (id) => api.post(`/approvals/${id}/approve`);
export const rejectItem = (id, data) => api.post(`/approvals/${id}/reject`, data);
export const approveByEntity = (entityType, entityId) => api.post(`/approve-entity/${entityType}/${entityId}`);
export const rejectByEntity = (entityType, entityId, data) => api.post(`/reject-entity/${entityType}/${entityId}`, data);

// Reports
export const getReport = (type, params) => api.get(`/reports/${type}`, { params });
export const getShareholderStatement = (id) => api.get(`/reports/shareholder-statement/${id}`);

// AGM
export const createMeeting = (data) => api.post('/agm/meetings', data);
export const getMeetingsApi = () => api.get('/agm/meetings');
export const updateMeeting = (id, data) => api.put(`/agm/meetings/${id}`, data);
export const deleteMeeting = (id) => api.delete(`/agm/meetings/${id}`);
export const createAgendaApi = (meetingId, data) => api.post(`/agm/meetings/${meetingId}/agendas`, data);
export const getAgendasApi = (meetingId) => api.get(`/agm/meetings/${meetingId}/agendas`);
export const updateAgendaApi = (agendaId, data) => api.put(`/agm/agendas/${agendaId}`, data);
export const deleteAgendaApi = (agendaId) => api.delete(`/agm/agendas/${agendaId}`);
export const activateAgendaApi = (agendaId) => api.post(`/agm/agendas/${agendaId}/activate`);
export const closeAgendaApi = (agendaId) => api.post(`/agm/agendas/${agendaId}/close`);
export const getAGMAnalytics = (meetingId) => api.get(`/agm/meetings/${meetingId}/analytics`);
export const getAGMAttendanceList = (meetingId) => api.get(`/agm/meetings/${meetingId}/attendance`);

// Documents
export const getDocuments = (params) => api.get('/documents', { params });
export const uploadDocument = (data) => api.post('/documents', data, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
export const updateDocument = (id, data) => api.put(`/documents/${id}`, data);
export const deleteDocument = (id) => api.delete(`/documents/${id}`);
export const getDocumentCategories = () => api.get('/documents/categories');

// Announcements
export const getAnnouncements = (params) => api.get('/announcements', { params });
export const createAnnouncement = (data) => api.post('/announcements', data, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
export const updateAnnouncement = (id, data) => api.put(`/announcements/${id}`, data);
export const deleteAnnouncement = (id) => api.delete(`/announcements/${id}`);

// Mini Apps
export const getMiniApps = (params) => api.get('/mini-apps', { params });
export const getMiniApp = (id) => api.get(`/mini-apps/${id}`);
export const createMiniApp = (data) => api.post('/mini-apps', data, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
export const updateMiniApp = (id, data) => api.put(`/mini-apps/${id}`, data, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
export const deleteMiniApp = (id) => api.delete(`/mini-apps/${id}`);
export const updateMiniAppStatus = (id, data) => api.put(`/mini-apps/${id}/status`, data);
export const reorderMiniApps = (data) => api.put('/mini-apps/reorder', data);
export const getMiniAppCategories = () => api.get('/mini-app-categories');
export const createMiniAppCategory = (data) => api.post('/mini-app-categories', data);
export const updateMiniAppCategory = (id, data) => api.put(`/mini-app-categories/${id}`, data);
export const deleteMiniAppCategory = (id) => api.delete(`/mini-app-categories/${id}`);

export default api;
