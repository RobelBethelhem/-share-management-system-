import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, InputNumber, Select, Input, Space, Tag, message, Alert, Typography, Row, Col } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getAllocations, allocateFromSubscriptions } from '../services/api';
import { formatCurrency } from '../utils/format';

const { Title } = Typography;

export default function Allocations() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roundFilter, setRoundFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getAllocations({ page, page_size: 20, search, round: roundFilter, status: statusFilter });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page, search, roundFilter, statusFilter]);

  const handleAllocate = async (values) => {
    try {
      const res = await allocateFromSubscriptions(values);
      const { count, skipped, pending_approval_count: pendingCount, round } = res.data;

      if (count > 0) {
        message.success(`Allocated for ${count} shareholder${count !== 1 ? 's' : ''} (Round ${round})`);
      }
      if (skipped > 0) {
        message.warning(`${skipped} subscription${skipped !== 1 ? 's' : ''} already allocated in Round ${round} — skipped.`);
      }
      if (pendingCount > 0) {
        message.warning(
          `${pendingCount} subscription${pendingCount !== 1 ? 's' : ''} could not be allocated because ${pendingCount !== 1 ? 'they are' : 'it is'} still pending approval. Go to Subscriptions and approve them first.`,
          8,
        );
      }
      if (count === 0 && skipped === 0 && pendingCount === 0) {
        message.info(`No eligible subscriptions found for Round ${round}.`);
      }

      setModalOpen(false);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const columns = [
    { title: 'Allocation No', dataIndex: 'allocation_no', width: 140 },
    { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
    { title: 'Round', dataIndex: 'round', width: 80 },
    { title: 'Shares', dataIndex: 'allocated_shares' },
    { title: 'Amount', dataIndex: 'allocated_amount', render: (v) => formatCurrency(v) },
    { title: 'Date', dataIndex: 'allocation_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'allocated' ? 'green' : 'orange'}>{s}</Tag> },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Allocations</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalOpen(true); }}>
          Allocate from Subscriptions
        </Button>
      </Row>

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
            placeholder="Filter by round"
            allowClear
            style={{ width: '100%' }}
            options={[1, 2, 3, 4, 5].map(r => ({ value: String(r), label: `Round ${r}` }))}
            onChange={(v) => { setRoundFilter(v || ''); setPage(1); }}
          />
        </Col>
        <Col span={4}>
          <Select
            placeholder="Filter by status"
            allowClear
            style={{ width: '100%' }}
            options={[
              { value: 'allocated', label: 'Allocated' },
              { value: 'pending', label: 'Pending' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
            onChange={(v) => { setStatusFilter(v || ''); setPage(1); }}
          />
        </Col>
      </Row>

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage, showTotal: (t) => `Total ${t}` }}
        scroll={{ x: 800 }} />

      <Modal title="Allocate from Subscriptions" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <Form form={form} layout="vertical" onFinish={handleAllocate}>
          <Form.Item name="round" label="Round" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={1} placeholder="1 = first round, 2 = re-allocation..." />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">Allocate</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
