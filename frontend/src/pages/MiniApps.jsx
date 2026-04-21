import { useState, useEffect } from 'react';
import {
  Card, Button, Modal, Form, Input, Select, Switch, Upload, Space, Tag,
  message, Typography, Row, Col, Popconfirm, InputNumber, Tabs, Empty, Badge, Divider,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined,
  AppstoreOutlined, GlobalOutlined, MobileOutlined, ApiOutlined,
  FolderOutlined, EyeOutlined,
} from '@ant-design/icons';
import {
  getMiniApps, createMiniApp, updateMiniApp, deleteMiniApp, updateMiniAppStatus,
  getMiniAppCategories, createMiniAppCategory, updateMiniAppCategory, deleteMiniAppCategory,
} from '../services/api';
import { API_ORIGIN as API_BASE } from '../utils/apiBase';

const { Title, Text, Paragraph } = Typography;

const launchTypeIcons = { screen: <MobileOutlined />, webview: <GlobalOutlined />, api: <ApiOutlined /> };
const launchTypeColors = { screen: 'blue', webview: 'green', api: 'purple' };

export default function MiniApps() {
  const [apps, setApps] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [iconFile, setIconFile] = useState([]);
  const [bannerFile, setBannerFile] = useState([]);
  const [form] = Form.useForm();
  const [catForm] = Form.useForm();

  const fetchApps = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterCategory) params.category_id = filterCategory;
      if (filterStatus) params.status = filterStatus;
      const res = await getMiniApps(params);
      setApps(res.data.data || []);
    } catch { message.error('Failed to load mini apps'); }
    setLoading(false);
  };

  const fetchCategories = async () => {
    try {
      const res = await getMiniAppCategories();
      setCategories(res.data.data || []);
    } catch {}
  };

  useEffect(() => { fetchApps(); fetchCategories(); }, [filterCategory, filterStatus]);

  const handleSubmit = async (values) => {
    const formData = new FormData();
    formData.append('name', values.name);
    formData.append('description', values.description || '');
    formData.append('route_path', values.route_path || '');
    formData.append('app_type', values.app_type || 'internal');
    formData.append('launch_type', values.launch_type || 'screen');
    formData.append('status', values.status ? 'active' : 'inactive');
    if (values.category_id) formData.append('category_id', values.category_id);
    if (values.display_order != null) formData.append('display_order', values.display_order);
    if (iconFile.length > 0 && iconFile[0].originFileObj) {
      formData.append('icon', iconFile[0].originFileObj);
    }
    if (bannerFile.length > 0 && bannerFile[0].originFileObj) {
      formData.append('banner', bannerFile[0].originFileObj);
    }

    try {
      if (editing) {
        await updateMiniApp(editing.id, formData);
        message.success('Mini app updated');
      } else {
        await createMiniApp(formData);
        message.success('Mini app created');
      }
      setModalOpen(false);
      setEditing(null);
      setIconFile([]);
      setBannerFile([]);
      form.resetFields();
      fetchApps();
    } catch (err) { message.error(err.response?.data?.error || 'Failed'); }
  };

  const handleEdit = (app) => {
    setEditing(app);
    form.setFieldsValue({
      ...app,
      status: app.status === 'active',
      category_id: app.category_id || undefined,
    });
    setIconFile(app.icon_url ? [{ uid: '-1', name: 'icon', status: 'done', url: API_BASE + app.icon_url }] : []);
    setBannerFile(app.banner_image ? [{ uid: '-1', name: 'banner', status: 'done', url: API_BASE + app.banner_image }] : []);
    setModalOpen(true);
  };

  const handleDelete = async (id) => {
    try {
      await deleteMiniApp(id);
      message.success('Deleted');
      fetchApps();
    } catch { message.error('Failed to delete'); }
  };

  const handleToggleStatus = async (app) => {
    try {
      await updateMiniAppStatus(app.id, { status: app.status === 'active' ? 'inactive' : 'active' });
      fetchApps();
    } catch { message.error('Failed to update status'); }
  };

  // Category CRUD
  const handleCatSubmit = async (values) => {
    try {
      if (editingCat) {
        await updateMiniAppCategory(editingCat.id, values);
        message.success('Category updated');
      } else {
        await createMiniAppCategory(values);
        message.success('Category created');
      }
      setCatModalOpen(false);
      setEditingCat(null);
      catForm.resetFields();
      fetchCategories();
    } catch (err) { message.error(err.response?.data?.error || 'Failed'); }
  };

  const handleDeleteCat = async (id) => {
    try {
      await deleteMiniAppCategory(id);
      message.success('Category deleted');
      fetchCategories();
    } catch (err) { message.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const getCategoryName = (id) => categories.find(c => c.id === id)?.name || '-';

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 20 }}>
        <Title level={3} style={{ margin: 0 }}><AppstoreOutlined /> Mini App Manager</Title>
        <Space>
          <Button icon={<FolderOutlined />} onClick={() => { setEditingCat(null); catForm.resetFields(); setCatModalOpen(true); }}>
            Categories
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {
            setEditing(null); form.resetFields();
            form.setFieldsValue({ app_type: 'internal', launch_type: 'screen', status: true, display_order: 0 });
            setIconFile([]); setBannerFile([]); setModalOpen(true);
          }}>Add Mini App</Button>
        </Space>
      </Row>

      {/* Filters */}
      <Space style={{ marginBottom: 16 }}>
        <Select placeholder="All Categories" allowClear style={{ width: 180 }}
          value={filterCategory || undefined} onChange={v => setFilterCategory(v || '')}>
          {categories.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
        </Select>
        <Select placeholder="All Status" allowClear style={{ width: 140 }}
          value={filterStatus || undefined} onChange={v => setFilterStatus(v || '')}>
          <Select.Option value="active">Active</Select.Option>
          <Select.Option value="inactive">Inactive</Select.Option>
        </Select>
      </Space>

      {/* Apps Grid */}
      <Row gutter={[16, 16]}>
        {apps.length === 0 && !loading && (
          <Col span={24}><Empty description="No mini apps yet. Click 'Add Mini App' to get started." /></Col>
        )}
        {apps.map(app => (
          <Col xs={24} sm={12} md={8} lg={6} key={app.id}>
            <Badge.Ribbon text={app.status === 'active' ? 'Active' : 'Inactive'}
              color={app.status === 'active' ? 'green' : 'red'}>
              <Card
                hoverable
                cover={app.banner_image ? (
                  <img alt="banner" src={API_BASE + app.banner_image}
                    style={{ height: 120, objectFit: 'cover' }} />
                ) : (
                  <div style={{ height: 120, background: 'linear-gradient(135deg, #e53935 0%, #880e4f 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {app.icon_url ? (
                      <img alt="icon" src={API_BASE + app.icon_url}
                        style={{ width: 48, height: 48, borderRadius: 12 }} />
                    ) : (
                      <AppstoreOutlined style={{ fontSize: 48, color: 'rgba(255,255,255,0.8)' }} />
                    )}
                  </div>
                )}
                actions={[
                  <Switch size="small" checked={app.status === 'active'} onChange={() => handleToggleStatus(app)} />,
                  ...(app.launch_type === 'webview' && app.route_path ? [
                    <EyeOutlined title="Preview" onClick={() => window.open(app.route_path, '_blank')} />,
                  ] : []),
                  <EditOutlined onClick={() => handleEdit(app)} />,
                  <Popconfirm title="Delete this mini app?" onConfirm={() => handleDelete(app.id)}>
                    <DeleteOutlined style={{ color: '#ff4d4f' }} />
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  avatar={app.icon_url ? (
                    <img src={API_BASE + app.icon_url} alt="icon"
                      style={{ width: 40, height: 40, borderRadius: 10 }} />
                  ) : null}
                  title={<Text strong>{app.name}</Text>}
                  description={
                    <div>
                      <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>
                        {app.description || 'No description'}
                      </Paragraph>
                      <Space size={4} wrap>
                        <Tag icon={launchTypeIcons[app.launch_type]} color={launchTypeColors[app.launch_type]}>
                          {app.launch_type}
                        </Tag>
                        <Tag>{app.app_type}</Tag>
                        {app.category_id && <Tag color="orange">{getCategoryName(app.category_id)}</Tag>}
                      </Space>
                      <div style={{ marginTop: 6 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Order: {app.display_order}</Text>
                      </div>
                    </div>
                  }
                />
              </Card>
            </Badge.Ribbon>
          </Col>
        ))}
      </Row>

      {/* Create/Edit Modal */}
      <Modal
        title={editing ? 'Edit Mini App' : 'Add Mini App'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        footer={null}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                <Input placeholder="e.g., Dividend Tracker" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="display_order" label="Order">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Brief description of the mini app" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="app_type" label="App Type">
                <Select>
                  <Select.Option value="internal">Internal</Select.Option>
                  <Select.Option value="external">External</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="launch_type" label="Launch Type">
                <Select>
                  <Select.Option value="screen">Screen</Select.Option>
                  <Select.Option value="webview">WebView</Select.Option>
                  <Select.Option value="api">API</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="category_id" label="Category">
                <Select allowClear placeholder="Select">
                  {categories.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="route_path" label="Route / URL"
            extra="For screen: screen name (e.g., Marketplace). For webview: full URL.">
            <Input placeholder="e.g., Marketplace or https://partner.com/app" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Icon">
                <Upload listType="picture-card" fileList={iconFile}
                  onChange={({ fileList }) => setIconFile(fileList)}
                  beforeUpload={() => false} maxCount={1} accept="image/*">
                  {iconFile.length === 0 && <div><UploadOutlined /><div style={{ marginTop: 4 }}>Icon</div></div>}
                </Upload>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Banner">
                <Upload listType="picture-card" fileList={bannerFile}
                  onChange={({ fileList }) => setBannerFile(fileList)}
                  beforeUpload={() => false} maxCount={1} accept="image/*">
                  {bannerFile.length === 0 && <div><UploadOutlined /><div style={{ marginTop: 4 }}>Banner</div></div>}
                </Upload>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="status" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => { setModalOpen(false); setEditing(null); }}>Cancel</Button>
              <Button type="primary" htmlType="submit">{editing ? 'Update' : 'Create'}</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Category Modal */}
      <Modal
        title="Mini App Categories"
        open={catModalOpen}
        onCancel={() => { setCatModalOpen(false); setEditingCat(null); catForm.resetFields(); }}
        footer={null}
        width={500}
      >
        {/* Category List */}
        <div style={{ marginBottom: 16 }}>
          {categories.map(cat => (
            <div key={cat.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', borderBottom: '1px solid #f0f0f0',
            }}>
              <Space>
                <Tag color="blue">{cat.display_order}</Tag>
                <Text strong>{cat.name}</Text>
                {cat.icon && <Text type="secondary">({cat.icon})</Text>}
              </Space>
              <Space size={4}>
                <Button size="small" type="link" onClick={() => {
                  setEditingCat(cat);
                  catForm.setFieldsValue(cat);
                }}>Edit</Button>
                <Popconfirm title="Delete category?" onConfirm={() => handleDeleteCat(cat.id)}>
                  <Button size="small" type="link" danger>Delete</Button>
                </Popconfirm>
              </Space>
            </div>
          ))}
          {categories.length === 0 && <Empty description="No categories" />}
        </div>

        <Divider />

        <Text strong>{editingCat ? 'Edit Category' : 'Add Category'}</Text>
        <Form form={catForm} layout="inline" onFinish={handleCatSubmit} style={{ marginTop: 8 }}>
          <Form.Item name="name" rules={[{ required: true }]}>
            <Input placeholder="Category name" />
          </Form.Item>
          <Form.Item name="icon">
            <Input placeholder="Icon name" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="display_order">
            <InputNumber placeholder="Order" min={0} style={{ width: 80 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">{editingCat ? 'Update' : 'Add'}</Button>
          </Form.Item>
          {editingCat && (
            <Form.Item>
              <Button onClick={() => { setEditingCat(null); catForm.resetFields(); }}>Cancel</Button>
            </Form.Item>
          )}
        </Form>
      </Modal>

    </div>
  );
}
