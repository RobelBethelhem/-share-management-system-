import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, DatePicker, InputNumber,
  Space, Tag, message, Typography, Row, Col, Popconfirm, Card, Statistic,
  Divider, Radio, Alert,
} from 'antd';
import { PlusOutlined, InfoCircleOutlined, LockOutlined, FilterOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getShareBlocks, createShareBlocksBatch, releaseShareBlock, searchShareholders,
  getShareholders, getShareholderInvestmentSummary, getBankCapital,
  searchShareBlocksAdvanced,
} from '../services/api';
import { formatCurrency, blockTypes } from '../utils/format';
import AdvancedSearchPanel from '../components/AdvancedSearchPanel';

const BLK_FIELDS = [
  { key: 'id',                     label: 'Block ID',          type: 'int' },
  { key: 'shareholder_id',         label: 'Shareholder ID',    type: 'int' },
  { key: 'allocation_id',          label: 'Allocation ID',     type: 'int' },
  { key: 'block_type',             label: 'Block Type',        type: 'enum', options: blockTypes },
  { key: 'shares_type',            label: 'Shares Type',       type: 'enum', options: [{value:'paid',label:'Paid'},{value:'unpaid',label:'Unpaid'},{value:'both',label:'Both'}] },
  { key: 'block_shares',           label: 'Block Shares',      type: 'int' },
  { key: 'paid_shares_to_block',   label: 'Paid Blocked',      type: 'int' },
  { key: 'unpaid_shares_to_block', label: 'Unpaid Blocked',    type: 'int' },
  { key: 'block_amount_birr',      label: 'Block Amount',      type: 'number' },
  { key: 'guarantee_amount',       label: 'Guarantee Amount',  type: 'number' },
  { key: 'service_fee',            label: 'Service Fee',       type: 'number' },
  { key: 'is_released',            label: 'Released',          type: 'bool' },
  { key: 'reason',                 label: 'Reason',            type: 'string' },
  { key: 'status',                 label: 'Status',            type: 'enum', options: [{value:'active',label:'Active'},{value:'released',label:'Released'}] },
  { key: 'approval_status',        label: 'Approval Status',   type: 'enum', options: [{value:'pending',label:'Pending'},{value:'approved',label:'Approved'},{value:'rejected',label:'Rejected'}] },
  { key: 'block_date',             label: 'Block Date',        type: 'date' },
  { key: 'release_date',           label: 'Release Date',      type: 'date' },
  { key: 'created_at',             label: 'Created Date',      type: 'date' },
];

const { Title, Text } = Typography;

const sharesTypeColors = { paid: 'blue', unpaid: 'orange', both: 'red' };
const sharesTypeLabels = { paid: 'Paid', unpaid: 'Unpaid', both: 'Both' };
const approvalColors = { pending: 'orange', approved: 'green', rejected: 'red' };

// Available paid/unpaid for an allocation (from the summary, which already
// nets out active+pending blocks via blocked_shares).
const availForAlloc = (a) => {
  if (!a) return { paid: 0, unpaid: 0, total: 0 };
  const paidShares = a.paid_shares || 0;
  const unpaidShares = (a.allocated_shares || 0) - paidShares;
  const blocked = a.blocked_shares || 0;
  const totalAvail = Math.max(0, (a.allocated_shares || 0) - blocked);
  return {
    paid: Math.min(paidShares, totalAvail),
    unpaid: Math.min(unpaidShares, totalAvail),
    total: totalAvail,
  };
};

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

  // Watch the block lines so each line's allocation/type/availability re-render.
  const watchedBlocks = Form.useWatch('blocks', form);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState(null);

  const fetchSimple = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getShareBlocks({ page, page_size: 20 });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load'); }
    setLoading(false);
  }, [page]);

  const fetchAdvanced = useCallback(async (filters) => {
    setLoading(true);
    try {
      const res = await searchShareBlocksAdvanced({ filters, page, page_size: 20 });
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
    // Reset the block lines to a single empty line whenever the shareholder changes.
    form.setFieldsValue({ blocks: [{ shares_type: 'both' }] });
    if (!shareholderId) return;
    setShSummaryLoading(true);
    try {
      const res = await getShareholderInvestmentSummary(shareholderId);
      setShSummary(res.data);
    } catch { /* ignore */ }
    setShSummaryLoading(false);
  };

  // Recompute a line's block amount from its shares × par value.
  const recalcLineAmount = (fieldName) => {
    if (parValue <= 0) return;
    const b = (form.getFieldValue('blocks') || [])[fieldName] || {};
    const sType = b.shares_type || 'both';
    const shares = sType === 'both'
      ? (b.paid_shares_to_block || 0) + (b.unpaid_shares_to_block || 0)
      : (b.block_shares || 0);
    form.setFieldValue(['blocks', fieldName, 'block_amount_birr'], shares * parValue);
  };

  const handleSubmit = async (values) => {
    try {
      const blocks = (values.blocks || []).map(b => {
        const sType = b.shares_type || 'both';
        const out = {
          allocation_id: b.allocation_id,
          shares_type: sType,
          service_fee: b.service_fee || 0,
          guarantee_amount: b.guarantee_amount || 0,
          block_amount_birr: b.block_amount_birr || 0,
        };
        if (sType === 'both') {
          out.paid_shares_to_block = b.paid_shares_to_block || 0;
          out.unpaid_shares_to_block = b.unpaid_shares_to_block || 0;
          out.block_shares = out.paid_shares_to_block + out.unpaid_shares_to_block;
        } else {
          out.block_shares = b.block_shares || 0;
        }
        return out;
      });
      const payload = {
        shareholder_id: values.shareholder_id,
        block_type: values.block_type,
        block_date: values.block_date ? values.block_date.toISOString() : undefined,
        reason: values.reason,
        blocks,
      };
      const res = await createShareBlocksBatch(payload);
      message.success(res.data?.message || 'Share block(s) created — pending approval');
      resetModal();
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleRelease = async (id) => {
    try {
      const res = await releaseShareBlock(id);
      message.success(res.data?.message || 'Release requested — pending approval');
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const resetModal = () => {
    form.resetFields();
    setShSummary(null);
    setModalOpen(false);
  };

  const allocById = (id) => (shSummary?.allocations || []).find(a => a.id === id) || null;

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 50 },
    { title: 'Sh. ID', key: 'shid', width: 75, render: (_, r) => r.shareholder_id ?? r.shareholder?.id ?? '-' },
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
      title: 'Approval', key: 'approval', width: 130,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Tag color={approvalColors[r.approval_status] || 'default'}>{(r.approval_status || 'pending').toUpperCase()}</Tag>
          {r.is_release_pending && !r.is_released && <Tag color="purple" style={{ fontSize: 10 }}>RELEASE PENDING</Tag>}
        </Space>
      ),
    },
    {
      title: 'Status', key: 'status',
      render: (_, r) => <Tag color={r.is_released ? 'green' : 'red'}>{r.is_released ? 'Released' : 'Active'}</Tag>,
    },
    {
      title: 'Actions', key: 'actions', width: 130,
      render: (_, r) => {
        if (r.is_released) return null;
        if (r.is_release_pending) return <Tag color="purple">Release pending</Tag>;
        if (r.approval_status === 'pending') return <Text type="secondary" style={{ fontSize: 12 }}>Awaiting approval</Text>;
        if (r.approval_status === 'rejected') return null;
        // Approved + active → release requires authorization.
        return (
          <Popconfirm
            title="Request release of this block?"
            description="This needs authorization — the shares stay blocked until the release is approved."
            okText="Request release"
            onConfirm={() => handleRelease(r.id)}
          >
            <Button size="small">Request release</Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Share Blocks</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          form.resetFields();
          form.setFieldsValue({ blocks: [{ shares_type: 'both' }] });
          setShSummary(null);
          setModalOpen(true);
        }}>
          New Block
        </Button>
      </Row>

      <Row style={{ marginBottom: 12 }} align="middle">
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
      </Row>

      <AdvancedSearchPanel
        fields={BLK_FIELDS}
        open={advancedOpen}
        onSearch={runAdvancedSearch}
        onReset={resetAdvancedSearch}
      />

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }} scroll={{ x: 1300 }} />

      <Modal
        title={<><LockOutlined /> New Share Block(s)</>}
        open={modalOpen} onCancel={resetModal} footer={null} width={820}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}
          initialValues={{ blocks: [{ shares_type: 'both' }] }}>

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

          {/* ── Shared block details ── */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="block_type" label="Block Reason" rules={[{ required: true }]}>
                <Select options={blockTypes} placeholder="Select reason" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="block_date" label="Block Date">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="reason" label="Reason / Notes">
            <Input.TextArea rows={2} />
          </Form.Item>

          {/* ── Allocations to block (one or more) ── */}
          <Divider orientation="left" style={{ margin: '8px 0' }}>Allocations to Block</Divider>
          <Form.List name="blocks">
            {(fields, { add, remove }) => {
              const blocks = watchedBlocks || form.getFieldValue('blocks') || [];
              const usedAllocIds = blocks.map(b => b?.allocation_id).filter(Boolean);
              return (
                <>
                  {fields.map(field => {
                    const line = blocks[field.name] || {};
                    const sType = line.shares_type || 'both';
                    const allocDetail = allocById(line.allocation_id);
                    const avail = availForAlloc(allocDetail);
                    const allocOpts = (shSummary?.allocations || [])
                      .filter(a => a.id === line.allocation_id || !usedAllocIds.includes(a.id))
                      .map(a => ({
                        value: a.id,
                        label: `${a.allocation_no} — Rnd ${a.round} — ${a.allocated_shares} sh (${(a.payment_status || '').replace(/_/g, ' ')})`,
                      }));
                    return (
                      <Card key={field.key} size="small" style={{ marginBottom: 8, borderColor: '#722ed1' }}
                        extra={fields.length > 1 && (
                          <Button type="text" danger size="small" icon={<DeleteOutlined />}
                            onClick={() => remove(field.name)}>Remove</Button>
                        )}>
                        <Form.Item name={[field.name, 'allocation_id']} label="Allocation"
                          rules={[{ required: true, message: 'Select an allocation' }]}
                          style={{ marginBottom: 8 }}>
                          <Select
                            options={allocOpts}
                            placeholder={shSummary ? 'Select allocation…' : 'Select a shareholder first'}
                            disabled={!shSummary}
                            onChange={() => {
                              form.setFieldsValue({ blocks: blocks.map((b, i) => i === field.name
                                ? { ...b, block_shares: undefined, paid_shares_to_block: undefined, unpaid_shares_to_block: undefined, block_amount_birr: undefined }
                                : b) });
                            }}
                          />
                        </Form.Item>

                        {allocDetail && (
                          <Row gutter={12} style={{ marginBottom: 8 }}>
                            <Col span={6}><Statistic title="Allocated" value={allocDetail.allocated_shares} valueStyle={{ fontSize: 14 }} /></Col>
                            <Col span={6}><Statistic title="Avail paid" value={avail.paid} valueStyle={{ fontSize: 14, color: '#52c41a' }} /></Col>
                            <Col span={6}><Statistic title="Avail unpaid" value={avail.unpaid} valueStyle={{ fontSize: 14, color: '#fa8c16' }} /></Col>
                            <Col span={6}><Statistic title="Already blocked" value={allocDetail.blocked_shares || 0} valueStyle={{ fontSize: 14, color: (allocDetail.blocked_shares || 0) > 0 ? '#ff4d4f' : undefined }} /></Col>
                          </Row>
                        )}

                        <Form.Item name={[field.name, 'shares_type']} label="Which Shares to Block"
                          rules={[{ required: true }]} style={{ marginBottom: 8 }}>
                          <Radio.Group onChange={() => {
                            form.setFieldsValue({ blocks: blocks.map((b, i) => i === field.name
                              ? { ...b, block_shares: undefined, paid_shares_to_block: undefined, unpaid_shares_to_block: undefined, block_amount_birr: undefined }
                              : b) });
                          }} size="small">
                            <Radio.Button value="paid">Paid</Radio.Button>
                            <Radio.Button value="unpaid">Unpaid</Radio.Button>
                            <Radio.Button value="both">Both</Radio.Button>
                          </Radio.Group>
                        </Form.Item>

                        {sType !== 'both' ? (
                          <Form.Item
                            name={[field.name, 'block_shares']}
                            label={`${sType === 'paid' ? 'Paid' : 'Unpaid'} shares to block (max ${sType === 'paid' ? avail.paid : avail.unpaid})`}
                            rules={[
                              { required: true, message: 'Required' },
                              { type: 'number', min: 1, message: 'Must be at least 1' },
                              {
                                validator: (_, v) => {
                                  if (!allocDetail || v == null) return Promise.resolve();
                                  const max = sType === 'paid' ? avail.paid : avail.unpaid;
                                  if (v > max) return Promise.reject(new Error(`Max available: ${max}`));
                                  return Promise.resolve();
                                },
                              },
                            ]}
                            style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={1} precision={0}
                              onChange={() => recalcLineAmount(field.name)} />
                          </Form.Item>
                        ) : (
                          <Row gutter={16}>
                            <Col span={12}>
                              <Form.Item name={[field.name, 'paid_shares_to_block']} label={`Paid shares (max ${avail.paid})`}
                                rules={[
                                  { type: 'number', min: 0, message: 'Cannot be negative' },
                                  { validator: (_, v) => (!allocDetail || !v || v <= avail.paid) ? Promise.resolve() : Promise.reject(new Error(`Max paid: ${avail.paid}`)) },
                                ]}
                                style={{ marginBottom: 8 }}>
                                <InputNumber style={{ width: '100%' }} min={0} precision={0}
                                  onChange={() => recalcLineAmount(field.name)} />
                              </Form.Item>
                            </Col>
                            <Col span={12}>
                              <Form.Item name={[field.name, 'unpaid_shares_to_block']} label={`Unpaid shares (max ${avail.unpaid})`}
                                rules={[
                                  { type: 'number', min: 0, message: 'Cannot be negative' },
                                  { validator: (_, v) => (!allocDetail || !v || v <= avail.unpaid) ? Promise.resolve() : Promise.reject(new Error(`Max unpaid: ${avail.unpaid}`)) },
                                ]}
                                style={{ marginBottom: 8 }}>
                                <InputNumber style={{ width: '100%' }} min={0} precision={0}
                                  onChange={() => recalcLineAmount(field.name)} />
                              </Form.Item>
                            </Col>
                          </Row>
                        )}

                        <Row gutter={16}>
                          <Col span={8}>
                            <Form.Item name={[field.name, 'block_amount_birr']}
                              label={`Block Amount${parValue ? ` (par ${formatCurrency(parValue)})` : ''}`} style={{ marginBottom: 0 }}>
                              <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item name={[field.name, 'service_fee']} label="Service Fee" style={{ marginBottom: 0 }}>
                              <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item name={[field.name, 'guarantee_amount']} label="Guarantee Amount" style={{ marginBottom: 0 }}>
                              <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                            </Form.Item>
                          </Col>
                        </Row>
                      </Card>
                    );
                  })}
                  <Button type="dashed" block icon={<PlusOutlined />}
                    disabled={!shSummary || fields.length >= (shSummary?.allocations?.length || 0)}
                    onClick={() => add({ shares_type: 'both' })}>
                    Add another allocation
                  </Button>
                </>
              );
            }}
          </Form.List>

          <Alert
            type="info" showIcon style={{ margin: '12px 0' }}
            message="Block and release both require authorization — created blocks stay pending until approved, and releasing a block must also be approved."
          />

          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={resetModal}>Cancel</Button>
              <Button type="primary" htmlType="submit" icon={<LockOutlined />}>Create Block(s)</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
