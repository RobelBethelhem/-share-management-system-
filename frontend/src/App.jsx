import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Shareholders from './pages/Shareholders';
import ShareholderDetail from './pages/ShareholderDetail';
import Subscriptions from './pages/Subscriptions';
import Allocations from './pages/Allocations';
import CapitalIncreases from './pages/CapitalIncreases';
import CapitalIncreaseDetail from './pages/CapitalIncreaseDetail';
import CIAdditionalRequests from './pages/CIAdditionalRequests';
import Investments from './pages/Investments';
import Transfers from './pages/Transfers';
import Dividends from './pages/Dividends';
import DividendSettings from './pages/DividendSettings';
import ShareBlocks from './pages/ShareBlocks';
import Certificates from './pages/Certificates';
import AGM from './pages/AGMMeetings';
import Approvals from './pages/Approvals';
import ShareSplits from './pages/ShareSplits';
import Reports from './pages/Reports';
import SystemSettings from './pages/SystemSettings';
import Documents from './pages/Documents';
import Announcements from './pages/Announcements';
import MiniApps from './pages/MiniApps';

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" />;
}

function App() {
  return (
    <ConfigProvider theme={{
      token: {
        colorPrimary: '#d32f2f',
        borderRadius: 6,
      },
    }}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={
              <ProtectedRoute><AppLayout /></ProtectedRoute>
            }>
              <Route index element={<Dashboard />} />
              <Route path="shareholders" element={<Shareholders />} />
              <Route path="shareholders/:id" element={<ShareholderDetail />} />
              <Route path="subscriptions" element={<Subscriptions />} />
              <Route path="allocations" element={<Allocations />} />
              <Route path="capital-increases" element={<CapitalIncreases />} />
              <Route path="capital-increases/:id" element={<CapitalIncreaseDetail />} />
              <Route path="capital-increase-additional" element={<CIAdditionalRequests />} />
              <Route path="investments" element={<Investments />} />
              <Route path="transfers" element={<Transfers />} />
              <Route path="dividends" element={<Dividends />} />
              <Route path="dividend-settings" element={<DividendSettings />} />
              <Route path="share-blocks" element={<ShareBlocks />} />
              <Route path="share-splits" element={<ShareSplits />} />
              <Route path="certificates" element={<Certificates />} />
              <Route path="agm" element={<AGM />} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="reports" element={<Reports />} />
              <Route path="system-settings" element={<SystemSettings />} />
              <Route path="documents" element={<Documents />} />
              <Route path="announcements" element={<Announcements />} />
              <Route path="mini-apps" element={<MiniApps />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ConfigProvider>
  );
}

export default App;
