import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, DatePicker, InputNumber,
  Space, Tag, message, Typography, Row, Col, Popconfirm, Card, Statistic,
  Divider, Radio, Alert,
} from 'antd';
import { PlusOutlined, InfoCircleOutlined, LockOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getShareBlocks, createShareBlock, releaseShareBlock, searchShareholders,
  getShareholders, getShareholderInvestmentSummary, getBankCapital,
} from '../services/api';
import { formatCurrency, blockTypes } from '../utils/format';

const { Title, Text } = Typography;

const sharesTypeColors = { paid: 'blue', unpaid: 'orange', both: 'red' };
const sharesTypeLabels = { paid: 'Paid', unpaid: 'Unpaid', both: 'Both' };

export default function ShareBlocks() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [shareholders, setShareholders] = useState([]);
  const [form] = Form.useForm();
  const [parValue, setParValue] = useState(0);

  // Summary state for the selected shareholder
  const [shSummary, setShSummary] = useState(null);
  const [shSummaryLoading, setShSummaryLoading] = useState(false);

  // Selected allocation
  const [selectedAllocID, setSelectedAllocID] = useState(null);

  // Watched form field
  const sharesType = Form.useWatch('shares_type', form) || 'both';

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getShareBlocks({ page, page_size: 20 });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page]);

  useEffect(() => {
    getBankCapital().then(res => {
      setParValue(res.data?.data?.par_value_per_share || 0);
    }).catch(() => {});
  }, []);

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

  const handleShareholderChange = async (shareholderId) => {
    setShSummary(null);
    setSelectedAllocID(null);
    form.setFieldsValue({
      allocation_id: undefined,
      block_shares: undefined,
      paid_shares_to_block: undefined,
      unpaid_shares_to_block: undefined,
      block_amount_birr: undefined,
    });
    if (!shareholderId) return;
    setShSummaryLoading(true);
    try {
      const res = await getShareholderInvestmentSummary(shareholderId);
      setShSummary(res.data);
    } catch { /* ignore */ }
    setShSummaryLoading(false);
  };

  const handleAllocationChange = (allocId) => {
    setSelectedAllocID(allocId);
    form.setFieldsValue({
      block_shares: undefined,
      paid_shares_to_block: undefined,
      unpaid_shares_to_block: undefined,
      block_amount_birr: undefined,
    });
  };

  const handleSharesTypeChange = () => {
    form.setFieldsValue({
      block_shares: undefined,
      paid_shares_to_block: undefined,
      unpaid_shares_to_block: undefined,
      block_amount_birr: undefined,
    });
  };

  // Auto-calculate block amount from shares × par value
  const recalcAmount = (paidShares, unpaidShares) => {
    if (parValue > 0) {
      form.setFieldValue('block_amount_birr', ((paidShares || 0) + (unpaidShares || 0)) * parValue);
    }
  };

  const handleSingleSharesChange = (val) => {
    if (sharesType === 'paid') recalcAmount(val, 0);
    else recalcAmount(0, val);
  };

  const handleBothSharesChange = () => {
    const p = form.getFieldValue('paid_shares_to_block') || 0;
    const u = form.getFieldValue('unpaid_shares_to_block') || 0;
    recalcAmount(p, u);
  };

  // Derive selected allocation detail from summary
  const selectedAllocDetail = shSummary?.allocations?.find(a => a.id === selectedAllocID) || null;

  // Available shares per type for the selected allocation (from summary data which already includes blocked_shares)
  const availByType = (() => {
    if (!selectedAllocDetail) return { paid: 0, unpaid: 0 };
    const paidShares = selectedAllocDetail.paid_shares || 0;
    const unpaidShares = (selectedAllocDetail.allocated_shares || 0) - paidShares;
    const blocked = selectedAllocDetail.blocked_shares || 0;
    // blocked_shares on alloc = sum of all blocks on that alloc (precise via backend)
    // For single-type: we approximate available by subtracting total blocked proportionally.
    // The backend will do the precise check on submit.
    // For the UI, we show approximate available:
    const availPaid = Math.max(0, paidShares - blocked);   // conservative: all blocks assumed against paid
    const availUnpaid = Math.max(0, unpaidShares - blocked); // conservative: all blocks assumed against unpaid
    // Better: use blocked_shares as total reduction from total, cap per type
    const totalAvail = Math.max(0, (selectedAllocDetail.allocated_shares || 0) - blocked);
    return {
      paid: Math.min(paidShares, totalAvail),
      unpaid: Math.min(unpaidShares, totalAvail),
      total: totalAvail,
    };
  })();

  const handleSubmit = async (values) => {
    try {
      // For "both" type: compute block_shares from the two inputs
      if (values.shares_type === 'both') {
        values.block_shares = (values.paid_shares_to_block || 0) + (values.unpaid_shares_to_block || 0);
      } else {
        values.paid_shares_to_block = undefined;
        values.unpaid_shares_to_block = undefined;
      }
      if (values.block_date) values.block_date = values.block_date.toISOString();
      await createShareBlock(values);
      message.success('Share block created');
      setModalOpen(false);
      form.resetFields();
      setShSummary(null);
      setSelectedAllocID(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleRelease = async (id) => {
    await releaseShareBlock(id);
    message.success('Released');
    fetchData();
  };

  const resetModal = () => {
    form.resetFields();
    setShSummary(null);
    setSelectedAllocID(null);
    setModalOpen(false);
  };

  // Allocation options from summary
  const allocOptions = (shSummary?.allocations || []).map(a => ({
    value: a.id,
    label: `${a.allocation_no} — Rnd ${a.round} — ${a.allocated_shares} shares (${(a.payment_status || '').replace(/_/g, ' ')})`,
  }));

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 50 },
    {
      title: 'Shareholder', key: 'sh',
      render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-',
    },
    {
      title: 'Allocation', key: 'alloc',
      render: (_, r) => r.allocation
        ? <Text style={{ fontSize: 12 }}>{r.allocation.allocation_no}</Text>
        : r.allocation_id
          ? <Tag color="orange" style={{ fontSize: 11 }}>#{r.allocation_id}</Tag>
          : <Tag color="red" style={{ fontSize: 11 }}>Legacy</Tag>,
    },
    { title: 'Block Reason', dataIndex: 'block_type', render: (t) => <Tag color="red">{t}</Tag> },
    {
      title: 'Shares Type', dataIndex: 'shares_type',
      render: (t) => t ? <Tag color={sharesTypeColors[t] || 'default'}>{sharesTypeLabels[t] || t}</Tag> : '—',
    },
    { title: 'Block Date', dataIndex: 'block_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '—' },
    {
      title: 'Blocked Shares', key: 'bs',
      render: (_, r) => {
        if (r.shares_type === 'both') {
          const p = r.paid_shares_to_block || 0;
          const u = r.unpaid_shares_to_block || 0;
          // Legacy block: split fields are 0 even though block_shares > 0
          if (p === 0 && u === 0) {
            return <Tag color="red">{r.block_shares} (legacy block)</Tag>;
          }
          return (
            <Space size={4}>
              <Tag color="blue">{p} paid</Tag>
              <Tag color="orange">{u} unpaid</Tag>
            </Space>
          );
        }
        return <Text>{r.block_shares}</Text>;
      },
    },
    { title: 'Block Amount', dataIndex: 'block_amount_birr', render: (v) => formatCurrency(v) },
    {
      title: 'Status', key: 'status',
      render: (_, r) => <Tag color={r.is_released ? 'green' : 'red'}>{r.is_released ? 'Released' : 'Active'}</Tag>,
    },
    {
      title: 'Actions', key: 'actions', width: 100,
      render: (_, r) => !r.is_released && (
        <Popconfirm title="Release this block?" onConfirm={() => handleRelease(r.id)}>
          <Button size="small">Release</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Share Blocks</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          form.resetFields();
          setShSummary(null);
          setSelectedAllocID(null);
          setModalOpen(true);
        }}>
          New Block
        </Button>
      </Row>

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }} scroll={{ x: 1200 }} />

      <Modal
        title={<><LockOutlined /> New Share Block</>}
        open={modalOpen} onCancel={resetModal} footer={null} width={760}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}
          initialValues={{ shares_type: 'both' }}>

          {/* ── Shareholder ── */}
          <Form.Item name="shareholder_id" label="Shareholder" rules={[{ required: true }]}>
            <Select
              showSearch filterOption={false}
              onSearch={handleSearch}
              options={shareholders}
              onDropdownVisibleChange={handleDropdownOpen}
              onChange={handleShareholderChange}
              placeholder="Search shareholder…"
            />
          </Form.Item>

          {/* ── Shareholder Summary ── */}
          {shSummaryLoading && <div style={{ textAlign: 'center', padding: 12 }}>Loading…</div>}
          {shSummary && !shSummaryLoading && (
            <Card size="small"
              title={<><InfoCircleOutlined /> Shareholder Share Summary</>}
              style={{ marginBottom: 16, borderColor: '#d32f2f' }}>
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic title="Total Allocated" value={shSummary.total_allocated_shares || 0} suffix="shares" />
                </Col>
                <Col span={6}>
                  <Statistic title="Paid Shares" value={shSummary.total_shares_paid || 0} suffix="shares"
                    valueStyle={{ color: '#52c41a' }} />
                </Col>
                <Col span={6}>
                  <Statistic title="Outstanding" value={formatCurrency(shSummary.outstanding_balance || 0)}
                    valueStyle={{ color: '#fa8c16', fontSize: 14 }} />
                </Col>
                <Col span={6}>
                  <Statistic title="Active Blocks" value={shSummary.blocked_shares || 0} suffix="shares"
                    valueStyle={(shSummary.blocked_shares || 0) > 0 ? { color: '#ff4d4f' } : {}} />
                </Col>
              </Row>

              {/* Per-allocation table */}
              {(shSummary.allocations || []).length > 0 && (
                <>
                  <Divider style={{ margin: '10px 0' }} />
                  <Text strong style={{ fontSize: 12 }}>Allocations</Text>
                  <Table
                    dataSource={shSummary.allocations}
                    rowKey="id"
                    size="small"
                    pagination={false}
                    style={{ marginTop: 6 }}
                    scroll={{ y: 160 }}
                    columns={[
                      { title: 'Alloc No', dataIndex: 'allocation_no', width: 160 },
                      { title: 'Rnd', dataIndex: 'round', width: 40 },
                      { title: 'Allocated', dataIndex: 'allocated_shares', width: 75 },
                      {
                        title: 'Paid', dataIndex: 'paid_shares', width: 60,
                        render: v => <Text style={{ color: '#52c41a' }}>{v || 0}</Text>,
                      },
                      {
                        title: 'Unpaid', key: 'unpaid', width: 65,
                        render: (_, r) => {
                          const u = (r.allocated_shares || 0) - (r.paid_shares || 0);
                          return <Text style={{ color: u > 0 ? '#fa8c16' : undefined }}>{u}</Text>;
                        },
                      },
                      {
                        title: 'Blocked', dataIndex: 'blocked_shares', width: 65,
                        render: v => v > 0
                          ? <Tag color="red" style={{ fontSize: 11 }}>{v}</Tag>
                          : <Text type="secondary">0</Text>,
                      },
                      {
                        title: 'Status', dataIndex: 'payment_status', width: 110,
                        render: s => {
                          const colors = { fully_paid: 'green', partially_paid: 'orange', not_started: 'default' };
                          return <Tag color={colors[s] || 'default'} style={{ fontSize: 11 }}>{(s || '').replace(/_/g, ' ')}</Tag>;
                        },
                      },
                    ]}
                  />
                </>
              )}
            </Card>
          )}

          {/* ── Allocation Selector ── */}
          <Form.Item name="allocation_id" label="Allocation to Block"
            rules={[{ required: true, message: 'Select an allocation' }]}>
            <Select
              options={allocOptions}
              onChange={handleAllocationChange}
              placeholder={shSummary ? 'Select allocation…' : 'Select a shareholder first'}
              disabled={!shSummary}
            />
          </Form.Item>

          {/* ── Per-Allocation block availability card ── */}
          {selectedAllocDetail && (
            <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}
              title={<Text strong style={{ fontSize: 13 }}>{selectedAllocDetail.allocation_no}</Text>}>
              <Row gutter={12}>
                <Col span={6}>
                  <Statistic title="Allocated" value={selectedAllocDetail.allocated_shares} />
                </Col>
                <Col span={6}>
                  <Statistic title="Paid Shares" value={selectedAllocDetail.paid_shares || 0}
                    valueStyle={{ color: '#52c41a' }} />
                </Col>
                <Col span={6}>
                  <Statistic title="Unpaid Shares"
                    value={(selectedAllocDetail.allocated_shares || 0) - (selectedAllocDetail.paid_shares || 0)}
                    valueStyle={{ color: '#fa8c16' }} />
                </Col>
                <Col span={6}>
                  <Statistic title="Already Blocked" value={selectedAllocDetail.blocked_shares || 0}
                    valueStyle={(selectedAllocDetail.blocked_shares || 0) > 0 ? { color: '#ff4d4f' } : {}} />
                </Col>
              </Row>
            </Card>
          )}

          {/* ── Block Reason & Date ── */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="block_type" label="Block Reason" rules={[{ required: true }]}>
                <Select options={blockTypes} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="block_date" label="Block Date">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          {/* ── Which shares to block ── */}
          <Form.Item name="shares_type" label="Which Shares to Block" rules={[{ required: true }]}>
            <Radio.Group onChange={handleSharesTypeChange}>
              <Radio.Button value="paid">Paid Shares</Radio.Button>
              <Radio.Button value="unpaid">Unpaid Shares</Radio.Button>
              <Radio.Button value="both">Both (Paid + Unpaid)</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {/* ── Share inputs — change by type ── */}
          {sharesType !== 'both' ? (
            /* Single input for "paid" or "unpaid" */
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="block_shares"
                  label={sharesType === 'paid' ? 'Paid Shares to Block' : 'Unpaid Shares to Block'}
                  rules={[
                    { required: true, message: 'Required' },
                    { type: 'number', min: 1, message: 'Must be at least 1' },
                    {
                      validator: (_, v) => {
                        if (!selectedAllocDetail) return Promise.resolve();
                        const avail = sharesType === 'paid' ? availByType.paid : availByType.unpaid;
                        if (v > avail) return Promise.reject(`Max available: ${avail}`);
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }} min={1}
                    max={selectedAllocDetail ? (sharesType === 'paid' ? availByType.paid : availByType.unpaid) : undefined}
                    onChange={handleSingleSharesChange}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                {selectedAllocDetail && (
                  <Alert
                    style={{ marginTop: 30 }}
                    type="info"
                    message={`Available ${sharesType} shares: ${sharesType === 'paid' ? availByType.paid : availByType.unpaid}`}
                    showIcon
                  />
                )}
              </Col>
            </Row>
          ) : (
            /* Two inputs for "both" */
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="paid_shares_to_block"
                    label="Paid Shares to Block"
                    rules={[
                      { required: true, message: 'Required' },
                      { type: 'number', min: 0, message: 'Cannot be negative' },
                      {
                        validator: (_, v) => {
                          if (!selectedAllocDetail || !v) return Promise.resolve();
                          if (v > availByType.paid) return Promise.reject(`Max available paid: ${availByType.paid}`);
                          return Promise.resolve();
                        },
                      },
                    ]}
                  >
                    <InputNumber
                      style={{ width: '100%' }} min={0}
                      max={selectedAllocDetail ? availByType.paid : undefined}
                      onChange={handleBothSharesChange}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="unpaid_shares_to_block"
                    label="Unpaid Shares to Block"
                    rules={[
                      { required: true, message: 'Required' },
                      { type: 'number', min: 0, message: 'Cannot be negative' },
                      {
                        validator: (_, v) => {
                          if (!selectedAllocDetail || !v) return Promise.resolve();
                          if (v > availByType.unpaid) return Promise.reject(`Max available unpaid: ${availByType.unpaid}`);
                          return Promise.resolve();
                        },
                      },
                    ]}
                  >
                    <InputNumber
                      style={{ width: '100%' }} min={0}
                      max={selectedAllocDetail ? availByType.unpaid : undefined}
                      onChange={handleBothSharesChange}
                    />
                  </Form.Item>
                </Col>
              </Row>
              {selectedAllocDetail && (
                <Alert
                  style={{ marginBottom: 12 }}
                  type="info"
                  message={`Available — Paid: ${availByType.paid} shares | Unpaid: ${availByType.unpaid} shares`}
                  showIcon
                />
              )}
            </>
          )}

          {/* ── Amounts ── */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="block_amount_birr"
                label={`Block Amount (Birr)${parValue ? ` — par value: ${formatCurrency(parValue)}/share` : ''}`}
              >
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="guarantee_amount" label="Guarantee Amount">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="service_fee" label="Service Fee">
            <InputNumber style={{ width: '100%' }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="reason" label="Reason / Notes">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={resetModal}>Cancel</Button>
              <Button type="primary" htmlType="submit" icon={<LockOutlined />}>Create Block</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
