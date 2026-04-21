import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Upload, Space, Tag, message,
  Typography, Row, Col, Popconfirm, Statistic, Card,
} from 'antd';
import {
  PlusOutlined, UploadOutlined, DeleteOutlined, EditOutlined,
  FileTextOutlined, FilePdfOutlined, FileExcelOutlined, FileImageOutlined,
  DownloadOutlined, InboxOutlined, FolderOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { getDocuments, uploadDocument, updateDocument, deleteDocument, getDocumentCategories } from '../services/api';
import { formatCurrency } from '../utils/format';
import { API_ORIGIN } from '../utils/apiBase';

const { Title, Text } = Typography;
const { TextArea } = Input;

const CATEGORIES = [
  { value: 'financial_reports', label: 'Financial Reports', color: 'blue' },
  { value: 'annual_reports', label: 'Annual Reports', color: 'green' },
  { value: 'agm_documents', label: 'AGM Documents', color: 'purple' },
  { value: 'regulatory_notices', label: 'Regulatory Notices', color: 'orange' },
  { value: 'dividend_announcements', label: 'Dividend Announcements', color: 'gold' },
  { value: 'other', label: 'Other', color: 'default' },
];

const catMap = {};
CATEGORIES.forEach(c => { catMap[c.value] = c; });

const getFileIcon = (type) => {
  if (!type) return <FileTextOutlined />;
  if (type === 'pdf') return <FilePdfOutlined style={{ color: '#e74c3c' }} />;
  if (['xls', 'xlsx', 'csv'].includes(type)) return <FileExcelOutlined style={{ color: '#27ae60' }} />;
  if (['png', 'jpg', 'jpeg'].includes(type)) return <FileImageOutlined style={{ color: '#3498db' }} />;
  return <FileTextOutlined style={{ color: '#7f8c8d' }} />;
};

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
};

export default function Documents() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [catCounts, setCatCounts] = useState([]);
  const [filterCat, setFilterCat] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [fileList, setFileList] = useState([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getDocuments({ page, page_size: 20, category: filterCat, q: searchQ });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load documents'); }
    setLoading(false);
  };

  const fetchCategories = async () => {
    try {
      const res = await getDocumentCategories();
      setCatCounts(res.data.data || []);
    } catch {}
  };

  useEffect(() => { fetchData(); }, [page, filterCat, searchQ]);
  useEffect(() => { fetchCategories(); }, []);

  const handleUpload = async () => {
    try {
      const values = await form.validateFields();
      if (fileList.length === 0) { message.error('Select a file'); return; }
      setUploading(true);
      const fd = new FormData();
      fd.append('title', values.title);
      fd.append('description', values.description || '');
      fd.append('category', values.category);
      fd.append('file', fileList[0].originFileObj || fileList[0]);
      await uploadDocument(fd);
      message.success('Document uploaded!');
      setUploadOpen(false);
      form.resetFields();
      setFileList([]);
      fetchData();
      fetchCategories();
    } catch (err) { message.error(err.response?.data?.error || 'Upload failed'); }
    setUploading(false);
  };

  const handleEdit = async () => {
    try {
      const values = await editForm.validateFields();
      await updateDocument(editRecord.id, values);
      message.success('Updated');
      setEditOpen(false);
      fetchData();
    } catch { message.error('Update failed'); }
  };

  const handleDelete = async (id) => {
    try {
      await deleteDocument(id);
      message.success('Deleted');
      fetchData();
      fetchCategories();
    } catch { message.error('Delete failed'); }
  };

  const openEdit = (record) => {
    setEditRecord(record);
    editForm.setFieldsValue({ title: record.title, description: record.description, category: record.category });
    setEditOpen(true);
  };

  const columns = [
    {
      title: 'Document', key: 'doc', render: (_, r) => (
        <Space>
          <span style={{ fontSize: 24 }}>{getFileIcon(r.file_type)}</span>
          <div>
            <div style={{ fontWeight: 600 }}>{r.title}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>{r.file_name}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: 'Category', dataIndex: 'category', width: 170,
      render: (cat) => {
        const c = catMap[cat] || { label: cat, color: 'default' };
        return <Tag color={c.color}>{c.label}</Tag>;
      },
    },
    { title: 'Size', dataIndex: 'file_size', width: 100, render: formatSize },
    { title: 'Downloads', dataIndex: 'downloads', width: 100, render: (d) => d || 0 },
    { title: 'Uploaded', dataIndex: 'created_at', width: 120, render: (d) => d ? dayjs(d).format('MMM D, YYYY') : '-' },
    {
      title: 'Actions', key: 'actions', width: 160,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<DownloadOutlined />}
            onClick={() => window.open(`${API_ORIGIN}${r.file_path}`, '_blank')}>
            Download
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="Delete?" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const totalDocs = catCounts.reduce((s, c) => s + c.count, 0);

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Document Center</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setFileList([]); setUploadOpen(true); }}>
          Upload Document
        </Button>
      </Row>

      {/* Category overview cards */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col>
          <Card size="small" hoverable onClick={() => setFilterCat('')}
            style={{ borderColor: !filterCat ? '#d32f2f' : undefined, minWidth: 120 }}>
            <Statistic title="All" value={totalDocs} prefix={<FolderOutlined />} valueStyle={{ fontSize: 20 }} />
          </Card>
        </Col>
        {CATEGORIES.map(cat => {
          const count = catCounts.find(c => c.category === cat.value)?.count || 0;
          return (
            <Col key={cat.value}>
              <Card size="small" hoverable onClick={() => setFilterCat(cat.value)}
                style={{ borderColor: filterCat === cat.value ? '#d32f2f' : undefined, minWidth: 120 }}>
                <Statistic title={cat.label} value={count} valueStyle={{ fontSize: 20 }} />
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* Search */}
      <Input.Search placeholder="Search documents..." allowClear
        onSearch={setSearchQ} style={{ marginBottom: 16, maxWidth: 400 }} />

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }} />

      {/* Upload Modal */}
      <Modal title="Upload Document" open={uploadOpen} onCancel={() => setUploadOpen(false)}
        onOk={handleUpload} confirmLoading={uploading} okText="Upload" width={550}>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="Document title" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={2} placeholder="Brief description..." />
          </Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true }]}>
            <Select options={CATEGORIES} placeholder="Select category" />
          </Form.Item>
          <Form.Item label="File" required>
            <Upload.Dragger fileList={fileList} onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
              beforeUpload={() => false} maxCount={1}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg">
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">Click or drag file to upload</p>
              <p className="ant-upload-hint">PDF, Excel, Word, Images supported</p>
            </Upload.Dragger>
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal title="Edit Document" open={editOpen} onCancel={() => setEditOpen(false)} onOk={handleEdit} okText="Save">
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Description"><TextArea rows={2} /></Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true }]}>
            <Select options={CATEGORIES} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
