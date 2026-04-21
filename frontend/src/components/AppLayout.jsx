import { useState } from 'react';
import { Layout, Menu, Button, Dropdown, Avatar, theme } from 'antd';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import {
  DashboardOutlined, UserOutlined, FileTextOutlined, BankOutlined,
  SwapOutlined, DollarOutlined, LockOutlined, SafetyCertificateOutlined,
  TeamOutlined, CheckCircleOutlined, BarChartOutlined, SettingOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, LogoutOutlined, FundOutlined,
  ContainerOutlined, SplitCellsOutlined, NotificationOutlined, FolderOpenOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/shareholders', icon: <UserOutlined />, label: 'Shareholders' },
  { key: '/subscriptions', icon: <FileTextOutlined />, label: 'Subscriptions' },
  { key: '/allocations', icon: <ContainerOutlined />, label: 'Allocations' },
  { key: '/investments', icon: <BankOutlined />, label: 'Investments' },
  { key: '/transfers', icon: <SwapOutlined />, label: 'Transfers' },
  {
    key: 'dividends-group', icon: <DollarOutlined />, label: 'Dividends',
    children: [
      { key: '/dividends', label: 'Dividend Payment' },
      { key: '/dividend-settings', label: 'Dividend Settings' },
    ],
  },
  { key: '/share-blocks', icon: <LockOutlined />, label: 'Share Blocks' },
  { key: '/share-splits', icon: <SplitCellsOutlined />, label: 'Share Splits' },
  { key: '/certificates', icon: <SafetyCertificateOutlined />, label: 'Certificates' },
  { key: '/agm', icon: <TeamOutlined />, label: 'AGM' },
  { key: '/approvals', icon: <CheckCircleOutlined />, label: 'Authorization' },
  { key: '/reports', icon: <BarChartOutlined />, label: 'Reports' },
  { key: '/documents', icon: <FolderOpenOutlined />, label: 'Documents' },
  { key: '/announcements', icon: <NotificationOutlined />, label: 'Announcements' },
  { key: '/mini-apps', icon: <AppstoreOutlined />, label: 'Mini Apps' },
  { key: '/system-settings', icon: <SettingOutlined />, label: 'System Settings' },
];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { token: { colorBgContainer, borderRadiusLG } } = theme.useToken();

  const handleMenuClick = ({ key }) => {
    if (key !== 'dividends-group') navigate(key);
  };

  const userMenuItems = [
    { key: 'profile', icon: <UserOutlined />, label: `${user?.full_name || user?.username}` },
    { key: 'settings', icon: <SettingOutlined />, label: 'Settings' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', danger: true },
  ];

  const handleUserMenu = ({ key }) => {
    if (key === 'logout') {
      logout();
      navigate('/login');
    }
  };

  const selectedKey = '/' + location.pathname.split('/')[1];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={240}
        style={{ background: '#2b0a0a' }}
      >
        <div style={{
          height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: collapsed ? 14 : 18, fontWeight: 'bold',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <FundOutlined style={{ marginRight: collapsed ? 0 : 8, fontSize: 22 }} />
          {!collapsed && 'Share Admin'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey === '/' ? '/' : selectedKey]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ borderRight: 0, background: '#2b0a0a' }}
        />
      </Sider>
      <Layout>
        <Header style={{
          padding: '0 24px', background: colorBgContainer,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: 16 }}
          />
          <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenu }} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar icon={<UserOutlined />} style={{ backgroundColor: '#d32f2f' }} />
              <span>{user?.full_name || user?.username}</span>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16 }}>
          <div style={{
            padding: 24, minHeight: 360, background: colorBgContainer,
            borderRadius: borderRadiusLG,
          }}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
