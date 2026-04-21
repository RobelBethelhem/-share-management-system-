import { useState, useEffect, useRef } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, DatePicker, InputNumber,
  Space, Tag, message, Typography, Row, Col, Popconfirm, Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckOutlined, CloseOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getSubscriptions, createSubscription, updateSubscription, deleteSubscription,
  reverseSubscription, extendSubscription, searchShareholders, getShareholders,
  approveByEntity, rejectByEntity, getBankCapital,
} from '../services/api';
import { formatCurrency } from '../utils/format';

const { Title } = Typography;

export default function Subscriptions() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [extendModal, setExtendModal] = useState(null);
  const [shareholders, setShareholders] = useState([]);
  const [rejectModal, setRejectModal] = useState(null);
  const [parValue, setParValue] = useState(0);
  const [form] = Form.useForm();
  const [extendForm] = Form.useForm();
  const [rejectForm] = Form.useForm();
  // track which field was last touched so we don't create a loop
  const lastChanged = useRef(null);

  // Fetch par value from bank capital settings once
  useEffect(() => {
    getBankCapital().then(res => {
      const pv = res.data?.data?.par_value_per_share || 0;
      setParValue(pv);
    }).catch(() => {});
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getSubscriptions({ page, page_size: 20, search, type: typeFilter, status: statusFilter });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page, search, typeFilter, statusFilter]);

  const handleSearch = async (val) => {
    if (!val || val.length < 1) return;
    try {
      const res = await searchShareholders(val);
      setShareholders((res.data.data || []).map(s => ({
        value: s.id, label: `${s.account_no} - ${s.first_name} ${s.last_name}`,
      })));
    } catch { setShareholders([]); }
  };

  const handleDropdownOpen = async (open) => {
    if (open && shareholders.length === 0) {
      try {
        const res = await getShareholders({ page: 1, page_size: 50 });
        setShareholders((res.data.data || []).map(s => ({
          value: s.id, label: `${s.account_no} - ${s.first_name} ${s.last_name}`,
        })));
      } catch { /* ignore */ }
    }
  };

  const openModal = (record = null) => {
    setEditingRecord(record);
    lastChanged.current = null;
    if (record) {
      form.setFieldsValue({
        shareholder_id: record.shareholder_id,
        type: record.type,
        par_value: parValue,
        share_amount: record.share_amount,
        number_of_shares: record.number_of_shares,
        subscription_date: record.subscription_date ? dayjs(record.subscription_date) : null,
        expiry_date: record.expiry_date ? dayjs(record.expiry_date) : null,
        remark: record.remark,
      });
    } else {
      form.resetFields();
      form.setFieldValue('par_value', parValue);
    }
    setModalOpen(true);
  };

  const handleAmountChange = (val) => {
    if (lastChanged.current === 'shares') return;
    lastChanged.current = 'amount';
    if (val > 0 && parValue > 0) {
      form.setFieldValue('number_of_shares', Math.floor(val / parValue));
    } else {
      form.setFieldValue('number_of_shares', 0);
    }
    lastChanged.current = null;
  };

  const handleSharesChange = (val) => {
    if (lastChanged.current === 'amount') return;
    lastChanged.current = 'shares';
    if (val > 0 && parValue > 0) {
      form.setFieldValue('share_amount', val * parValue);
    } else {
      form.setFieldValue('share_amount', 0);
    }
    lastChanged.current = null;
  };

  const handleSubmit = async (values) => {
    try {
      if (values.subscription_date) values.subscription_date = values.subscription_date.toISOString();
      if (values.expiry_date) values.expiry_date = values.expiry_date.toISOString();

      if (editingRecord) {
        await updateSubscription(editingRecord.id, values);
        message.success('Subscription updated');
      } else {
        await createSubscription(values);
        message.success('Subscription created, pending approval');
      }
      setModalOpen(false);
      setEditingRecord(null);
      form.resetFields();
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteSubscription(id);
      message.success('Subscription deleted');
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleReverse = async (id) => {
    try {
      await reverseSubscription(id);
      message.success('Subscription reversed');
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to reverse');
    }
  };

  const handleExtend = async (values) => {
    try {
      await extendSubscription(extendModal.id, {
        new_expiry_date: values.new_expiry_date.format('YYYY-MM-DD'),
      });
      message.success('Subscription extended');
      setExtendModal(null);
      extendForm.resetFields();
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to extend');
    }
  };

  const handleApprove = async (id) => {
    try {
      await approveByEntity('subscription', id);
      message.success('Subscription approved');
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to approve');
    }
  };

  const handleReject = async (values) => {
    try {
      await rejectByEntity('subscription', rejectModal.id, values);
      message.success('Subscription rejected');
      setRejectModal(null);
      rejectForm.resetFields();
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to reject');
    }
  };

  const statusColors = { active: 'green', reversed: 'red', extended: 'blue', expired: 'volcano' };
  const approvalColors = { pending: 'orange', approved: 'green', rejected: 'red' };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: 'Shareholder', key: 'sh',
      render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-',
    },
    { title: 'Type', dataIndex: 'type', render: (t) => <Tag color="blue">{t}</Tag> },
    { title: 'Amount', dataIndex: 'share_amount', render: (v) => formatCurrency(v) },
    { title: 'Shares', dataIndex: 'number_of_shares' },
    { title: 'Par Value', dataIndex: 'par_value', render: (v) => formatCurrency(v) },
    { title: 'Date', dataIndex: 'subscription_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-', width: 110 },
    { title: 'Expiry', dataIndex: 'expiry_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-', width: 110 },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={statusColors[s] || 'default'}>{s}</Tag> },
    { title: 'Approval', dataIndex: 'approval_status', render: (s) => <Tag color={approvalColors[s] || 'default'}>{s}</Tag> },
    {
      title: 'Actions', key: 'actions', width: 280,
      render: (_, r) => (
        <Space wrap>
          {r.approval_status === 'pending' && (
            <>
              <Popconfirm title="Approve this subscription?" onConfirm={() => handleApprove(r.id)}>
                <Button size="small" type="primary" icon={<CheckOutlined />}>Approve</Button>
              </Popconfirm>
              <Button size="small" danger icon={<CloseOutlined />}
                onClick={() => { setRejectModal(r); rejectForm.resetFields(); }}>Reject</Button>
            </>
          )}
          {r.approval_status === 'pending' && (
            <>
              <Tooltip title="Edit (only while pending)">
                <Button size="small" icon={<EditOutlined />} onClick={() => openModal(r)}>Edit</Button>
              </Tooltip>
              <Popconfirm title="Delete this subscription?" onConfirm={() => handleDelete(r.id)}>
                <Button size="small" danger icon={<DeleteOutlined />}>Delete</Button>
              </Popconfirm>
            </>
          )}
          {r.approval_status === 'approved' && (r.status === 'active' || r.status === 'extended') && (
            <Popconfirm title="Reverse this subscription?" onConfirm={() => handleReverse(r.id)}>
              <Button size="small" danger>Reverse</Button>
            </Popconfirm>
          )}
          {r.approval_status === 'approved' && (r.status === 'active' || r.status === 'expired') && (
            <Button size="small" onClick={() => {
              setExtendModal(r);
              extendForm.setFieldsValue({
                new_expiry_date: r.expiry_date ? dayjs(r.expiry_date).add(30, 'day') : dayjs().add(30, 'day'),
              });
            }}>Extend</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Subscriptions</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
          New Subscription
        </Button>
      </Row>

      {/* Search & Filter bar */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Input.Search
            placeholder="Search by shareholder name or account..."
            prefix={<SearchOutlined />}
            allowClear
            onSearch={(v) => { setSearch(v); setPage(1); }}
          />
        </Col>
        <Col span={4}>
          <Select
            placeholder="Filter by type"
            allowClear
            style={{ width: '100%' }}
            options={[
              { value: 'pre-subscription', label: 'Pre-Subscription' },
              { value: 'confirmation', label: 'Confirmation' },
              { value: 'additional', label: 'Additional' },
            ]}
            onChange={(v) => { setTypeFilter(v || ''); setPage(1); }}
          />
        </Col>
        <Col span={4}>
          <Select
            placeholder="Filter by status"
            allowClear
            style={{ width: '100%' }}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'expired', label: 'Expired' },
              { value: 'reversed', label: 'Reversed' },
              { value: 'extended', label: 'Extended' },
            ]}
            onChange={(v) => { setStatusFilter(v || ''); setPage(1); }}
          />
        </Col>
      </Row>

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage, showTotal: (t) => `Total ${t}` }}
        scroll={{ x: 1200 }} />

      {/* Create / Edit Modal */}
      <Modal title={editingRecord ? 'Edit Subscription' : 'New Subscription'}
        open={modalOpen} onCancel={() => { setModalOpen(false); setEditingRecord(null); }} footer={null} width={600}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="shareholder_id" label="Shareholder" rules={[{ required: true }]}>
            <Select showSearch filterOption={false} onSearch={handleSearch} options={shareholders}
              onDropdownVisibleChange={handleDropdownOpen}
              placeholder="Search shareholder..." disabled={!!editingRecord} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="type" label="Type" rules={[{ required: true }]}>
                <Select options={[
                  { value: 'pre-subscription', label: 'Pre-Subscription' },
                  { value: 'confirmation', label: 'Confirmation' },
                  { value: 'additional', label: 'Additional' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="par_value" label="Par Value (from settings)">
                <InputNumber style={{ width: '100%' }} disabled />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="share_amount" label="Share Amount" rules={[{ required: true }]}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={parValue || 1}
                  formatter={(v) => v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                  parser={(v) => v.replace(/,/g, '')}
                  onChange={handleAmountChange}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="number_of_shares" label="Number of Shares" rules={[{ required: true }]}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  precision={0}
                  onChange={handleSharesChange}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="subscription_date" label="Subscription Date">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="expiry_date" label="Expiry Date">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="remark" label="Remark">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => { setModalOpen(false); setEditingRecord(null); }}>Cancel</Button>
              <Button type="primary" htmlType="submit">{editingRecord ? 'Update' : 'Create'}</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Extend Modal */}
      <Modal title="Extend Subscription" open={!!extendModal}
        onCancel={() => { setExtendModal(null); extendForm.resetFields(); }} footer={null} width={400}>
        {extendModal && (
          <div style={{ marginBottom: 16 }}>
            <p><strong>Current Expiry:</strong> {extendModal.expiry_date ? dayjs(extendModal.expiry_date).format('YYYY-MM-DD') : 'Not set'}</p>
            <p><strong>Status:</strong> <Tag color={statusColors[extendModal.status]}>{extendModal.status}</Tag></p>
          </div>
        )}
        <Form form={extendForm} layout="vertical" onFinish={handleExtend}>
          <Form.Item name="new_expiry_date" label="New Expiry Date" rules={[{ required: true, message: 'Please select the new expiry date' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => { setExtendModal(null); extendForm.resetFields(); }}>Cancel</Button>
              <Button type="primary" htmlType="submit">Extend</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Reject Modal */}
      <Modal title="Reject Subscription" open={!!rejectModal}
        onCancel={() => { setRejectModal(null); rejectForm.resetFields(); }} footer={null} width={400}>
        <Form form={rejectForm} layout="vertical" onFinish={handleReject}>
          <Form.Item name="remark" label="Reason for Rejection" rules={[{ required: true, message: 'Please provide a reason' }]}>
            <Input.TextArea rows={3} placeholder="Enter reason for rejection..." />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => { setRejectModal(null); rejectForm.resetFields(); }}>Cancel</Button>
              <Button type="primary" danger htmlType="submit">Reject</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
