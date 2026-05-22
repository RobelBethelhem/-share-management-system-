import { useState, useEffect } from 'react';
import {
  Table, Button, Tag, Modal, Form, Input, InputNumber, message, Typography, Row, Select, Space, Popconfirm, Alert,
} from 'antd';
import { CheckOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  listAllCIAdditionalRequests, approveCIAdditionalRequest, rejectCIAdditionalRequest,
  getCapitalIncreases, createCIAdditionalRequest, getShareholders,
} from '../services/api';
import { formatNumber } from '../utils/format';

const { Title } = Typography;

const STATUS_COLORS = { pending: 'orange', approved: 'green', rejected: 'red' };

export default function CIAdditionalRequests() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [approveOpen, setApproveOpen] = useState(false);
  const [currentReq, setCurrentReq] = useState(null);
  const [approveForm] = Form.useForm();

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [openCIs, setOpenCIs] = useState([]);
  const [shareholders, setShareholders] = useState([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await listAllCIAdditionalRequests(statusFilter ? { status: statusFilter } : {});
      setData(res.data.data || []);
    } catch {
      message.error('Failed to load requests');
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [statusFilter]);

  const loadCreatePrereqs = async () => {
    try {
      const [ciRes, shRes] = await Promise.all([
        getCapitalIncreases(),
        getShareholders({ page_size: 500 }),
      ]);
      setOpenCIs((ciRes.data.data || []).filter((c) => c.status === 'additional_open'));
      setShareholders(shRes.data.data || []);
    } catch {
      message.error('Failed to load options');
    }
  };

  const openCreate = async () => {
    await loadCreatePrereqs();
    createForm.resetFields();
    setCreateOpen(true);
  };

  const handleCreate = async (values) => {
    try {
      await createCIAdditionalRequest(values.capital_increase_id, {
        shareholder_id: values.shareholder_id,
        requested_shares: values.requested_shares,
        note: values.note,
      });
      message.success('Request submitted');
      setCreateOpen(false);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const openApprove = (req) => {
    setCurrentReq(req);
    approveForm.setFieldsValue({ approved_shares: req.requested_shares });
    setApproveOpen(true);
  };

  const handleApprove = async (values) => {
    try {
      await approveCIAdditionalRequest(currentReq.capital_increase_id, currentReq.id, values);
      message.success('Approved');
      setApproveOpen(false);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleReject = async (req) => {
    try {
      await rejectCIAdditionalRequest(req.capital_increase_id, req.id);
      message.success('Rejected');
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const columns = [
    { title: 'Capital Increase', key: 'ci', render: (_, r) => r.capital_increase?.label || `#${r.capital_increase_id}` },
    { title: 'Sh. ID', key: 'shid', width: 75, render: (_, r) => r.shareholder_id ?? r.shareholder?.id ?? '-' },
    { title: 'Shareholder', key: 'sh',
      render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : `#${r.shareholder_id}` },
    { title: 'Account', key: 'acc', render: (_, r) => r.shareholder?.account_no || '-' },
    { title: 'Requested', dataIndex: 'requested_shares', render: (v) => formatNumber(v) },
    { title: 'Approved', dataIndex: 'approved_shares', render: (v) => v > 0 ? formatNumber(v) : '-' },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={STATUS_COLORS[s] || 'default'}>{s}</Tag> },
    { title: 'Date', dataIndex: 'created_at', render: (d) => dayjs(d).format('YYYY-MM-DD HH:mm') },
    { title: 'Note', dataIndex: 'note', ellipsis: true },
    { title: 'Actions', key: 'actions',
      render: (_, r) => r.status !== 'pending' ? null : (
        <Space>
          <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => openApprove(r)}>Approve</Button>
          <Popconfirm title="Reject this request?" onConfirm={() => handleReject(r)}>
            <Button size="small" danger icon={<CloseOutlined />}>Reject</Button>
          </Popconfirm>
        </Space>
      ) },
  ];

  return (
    <div>
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="Prefer auto-distribution"
        description="When a campaign still has remaining shares and is below its max auto rounds, the cleanest way to allocate pending requests is to open the campaign and click Run Round N — the Hamilton math will distribute the remaining pool proportionally and cap each shareholder at their requested amount. Use this page only when you need to manually override individual requests (e.g., after max auto rounds are exhausted)."
      />
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Additional Share Requests</Title>
        <Space>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 180 }}
            allowClear
            placeholder="All statuses"
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>New Request</Button>
        </Space>
      </Row>

      <Table
        dataSource={data}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 20 }}
        scroll={{ x: 1000 }}
      />

      <Modal
        title="Approve Additional Request"
        open={approveOpen}
        onCancel={() => setApproveOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={approveForm} layout="vertical" onFinish={handleApprove}>
          <p>
            <strong>{currentReq?.shareholder ? `${currentReq.shareholder.first_name} ${currentReq.shareholder.last_name}` : ''}</strong>
            {' requested '}
            <strong>{formatNumber(currentReq?.requested_shares || 0)}</strong> shares.
          </p>
          <Form.Item name="approved_shares" label="Approved Shares" rules={[{ required: true, message: 'Required' }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setApproveOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">Approve</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="New Additional Request"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="capital_increase_id" label="Capital Increase" rules={[{ required: true, message: 'Required' }]}>
            <Select
              placeholder={openCIs.length === 0 ? 'No campaigns in additional phase' : 'Select campaign'}
              disabled={openCIs.length === 0}
              options={openCIs.map((c) => ({ value: c.id, label: c.label }))}
            />
          </Form.Item>
          <Form.Item name="shareholder_id" label="Shareholder" rules={[{ required: true, message: 'Required' }]}>
            <Select
              placeholder="Select shareholder"
              showSearch
              optionFilterProp="label"
              options={shareholders.map((s) => ({ value: s.id, label: `${s.first_name} ${s.last_name} (${s.account_no})` }))}
            />
          </Form.Item>
          <Form.Item name="requested_shares" label="Requested Shares" rules={[{ required: true, message: 'Required' }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="Note">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">Submit</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
