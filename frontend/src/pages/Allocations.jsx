import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Modal, Form, InputNumber, Select, Input, Space, Tag, message, Alert, Typography, Row, Col } from 'antd';
import { PlusOutlined, SearchOutlined, FilterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getAllocations, allocateFromSubscriptions, searchAllocationsAdvanced } from '../services/api';
import { formatCurrency } from '../utils/format';
import AdvancedSearchPanel from '../components/AdvancedSearchPanel';

const { Title } = Typography;

const ALLOC_FIELDS = [
  { key: 'id',                  label: 'Allocation ID',       type: 'int' },
  { key: 'shareholder_id',      label: 'Shareholder ID',      type: 'int' },
  { key: 'subscription_id',     label: 'Subscription ID',     type: 'int' },
  { key: 'capital_increase_id', label: 'Capital Increase ID', type: 'int' },
  { key: 'allocation_no',       label: 'Allocation No',       type: 'string' },
  { key: 'round',               label: 'Round',               type: 'int' },
  { key: 'allocated_shares',    label: 'Allocated Shares',    type: 'int' },
  { key: 'allocated_amount',    label: 'Allocated Amount',    type: 'number' },
  { key: 'status',              label: 'Status',              type: 'enum', options: [{value:'pending',label:'Pending'},{value:'allocated',label:'Allocated'},{value:'cancelled',label:'Cancelled'}] },
  { key: 'approval_status',     label: 'Approval Status',     type: 'enum', options: [{value:'pending',label:'Pending'},{value:'approved',label:'Approved'},{value:'rejected',label:'Rejected'}] },
  { key: 'allocation_date',     label: 'Allocation Date',     type: 'date' },
  { key: 'created_at',          label: 'Created Date',        type: 'date' },
];

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

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState(null);

  const fetchSimple = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAllocations({ page, page_size: 20, search, round: roundFilter, status: statusFilter });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load'); }
    setLoading(false);
  }, [page, search, roundFilter, statusFilter]);

  const fetchAdvanced = useCallback(async (filters) => {
    setLoading(true);
    try {
      const res = await searchAllocationsAdvanced({ filters, page, page_size: 20 });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch (err) { message.error(err.response?.data?.error || 'Search failed'); }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    if (activeFilters) fetchAdvanced(activeFilters);
    else fetchSimple();
  }, [activeFilters, fetchAdvanced, fetchSimple]);

  const runAdvancedSearch = (cleaned) => {
    if (cleaned.length === 0) { message.warning('Add at least one filter.'); return; }
    setPage(1);
    setActiveFilters(cleaned);
  };
  const resetAdvancedSearch = () => { setActiveFilters(null); setPage(1); };

  const fetchData = () => { if (activeFilters) fetchAdvanced(activeFilters); else fetchSimple(); };

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
    { title: 'Sh. ID', key: 'shid', width: 75, render: (_, r) => r.shareholder_id ?? r.shareholder?.id ?? '-' },
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

      <Row gutter={16} style={{ marginBottom: 16 }} align="middle">
        <Col span={8}>
          <Input.Search
            placeholder="Search by shareholder name or account..."
            prefix={<SearchOutlined />}
            allowClear
            disabled={!!activeFilters}
            onSearch={(v) => { setSearch(v); setPage(1); }}
          />
        </Col>
        <Col span={4}>
          <Select
            placeholder="Filter by round"
            allowClear
            style={{ width: '100%' }}
            disabled={!!activeFilters}
            options={[1, 2, 3, 4, 5].map(r => ({ value: String(r), label: `Round ${r}` }))}
            onChange={(v) => { setRoundFilter(v || ''); setPage(1); }}
          />
        </Col>
        <Col span={4}>
          <Select
            placeholder="Filter by status"
            allowClear
            style={{ width: '100%' }}
            disabled={!!activeFilters}
            options={[
              { value: 'allocated', label: 'Allocated' },
              { value: 'pending', label: 'Pending' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
            onChange={(v) => { setStatusFilter(v || ''); setPage(1); }}
          />
        </Col>
        <Col span={6}>
          <Button
            icon={<FilterOutlined />}
            type={advancedOpen ? 'primary' : 'default'}
            onClick={() => setAdvancedOpen(o => !o)}
          >
            {advancedOpen ? 'Hide Advanced Search' : 'Advanced Search'}
          </Button>
          {activeFilters && (
            <Tag color="blue" closable onClose={resetAdvancedSearch} style={{ marginLeft: 8 }}>
              {activeFilters.length} filter{activeFilters.length === 1 ? '' : 's'} applied
            </Tag>
          )}
        </Col>
      </Row>

      <AdvancedSearchPanel
        fields={ALLOC_FIELDS}
        open={advancedOpen}
        onSearch={runAdvancedSearch}
        onReset={resetAdvancedSearch}
      />

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
