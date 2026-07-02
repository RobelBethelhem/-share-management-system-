import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, DatePicker, InputNumber,
  Space, Tag, message, Typography, Row, Col, Switch, Tooltip, Card, Descriptions, Spin, Divider, Alert,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, FilterOutlined,
  CheckCircleOutlined, ClockCircleOutlined, MinusCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getInvestments, createInvestment, searchShareholders, getShareholders,
  getShareholderInvestmentSummary, getBankCapital, searchInvestmentsAdvanced,
  getDividends, reinvestDividend,
} from '../services/api';
import { formatCurrency, paymentMethods } from '../utils/format';
import { formatEthiopianDate } from '../utils/ethiopianDate';
import AdvancedSearchPanel from '../components/AdvancedSearchPanel';

const { Title, Text } = Typography;

// Subscription expiry gate: payments are blocked the day AFTER the expiry
// date (the expiry day itself still accepts payments). Extend lifts it.
const subExpired = (a) =>
  !!a?.subscription_expiry && dayjs().startOf('day').isAfter(dayjs(a.subscription_expiry).startOf('day'));

const statusColors = { fully_paid: 'green', partially_paid: 'orange', not_started: 'default' };
const statusLabels = { fully_paid: 'Fully Paid', partially_paid: 'Partially Paid', not_started: 'Not Started' };
const statusIcons = {
  fully_paid: <CheckCircleOutlined />,
  partially_paid: <ClockCircleOutlined />,
  not_started: <MinusCircleOutlined />,
};

// Advanced search whitelist — mirrors backend's investmentFieldType
const INV_FIELDS = [
  { key: 'id',                 label: 'Investment ID',     type: 'int' },
  { key: 'shareholder_id',     label: 'Shareholder ID',    type: 'int' },
  { key: 'allocation_id',      label: 'Allocation ID',     type: 'int' },
  { key: 'payment_method',     label: 'Payment Method',    type: 'enum', options: paymentMethods },
  { key: 'from_account',       label: 'From Account',      type: 'string' },
  { key: 'reference_no',       label: 'Reference No',      type: 'string' },
  { key: 'amount',             label: 'Amount (ETB)',      type: 'number' },
  { key: 'number_of_shares',   label: 'Number of Shares',  type: 'int' },
  { key: 'par_value',          label: 'Par Value',         type: 'number' },
  { key: 'premium_value',      label: 'Premium Value',     type: 'number' },
  { key: 'is_standing',        label: 'Standing Instr.',   type: 'bool' },
  { key: 'standing_frequency', label: 'Frequency',         type: 'enum', options: [{value:'monthly',label:'Monthly'},{value:'quarterly',label:'Quarterly'}] },
  { key: 'status',             label: 'Status',            type: 'enum', options: [{value:'active',label:'Active'},{value:'reversed',label:'Reversed'}] },
  { key: 'approval_status',    label: 'Approval Status',   type: 'enum', options: [{value:'pending',label:'Pending'},{value:'approved',label:'Approved'},{value:'rejected',label:'Rejected'}] },
  { key: 'remark',             label: 'Remark',            type: 'string' },
  { key: 'payment_date',       label: 'Payment Date',      type: 'date' },
  { key: 'amharic_date',       label: 'Ethiopian Date',    type: 'string' },
  { key: 'created_at',         label: 'Created Date',      type: 'date' },
];

export default function Investments() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [shareholders, setShareholders] = useState([]);
  const [parValue, setParValue] = useState(0);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [selectedAlloc, setSelectedAlloc] = useState(null); // for cap validation
  const [allocDetailOpen, setAllocDetailOpen] = useState(false); // per-allocation detail modal
  // Dividend-as-payment: the shareholder's reinvestable dividends + the chosen source.
  const [shDividends, setShDividends] = useState([]);
  const [selectedDividend, setSelectedDividend] = useState(null);
  const [dividendsLoading, setDividendsLoading] = useState(false);
  const [form] = Form.useForm();
  const lastChanged = useRef(null);

  // Reactive watches so the dividend section can preview shares live.
  const watchedMethod = Form.useWatch('payment_method', form);
  const watchedDivReinvest = Form.useWatch('div_reinvest_amount', form);
  const watchedDivAdditional = Form.useWatch('div_additional_amount', form);

  // Reinvestable balance of a dividend = gross − already-reinvested − collected.
  const reinvestableOf = (d) => d
    ? Math.max(0, (d.gross_dividend || 0) - (d.reinvested_amount || 0) - (d.collected_amount || 0))
    : 0;

  // Fetch par value from bank capital settings
  useEffect(() => {
    getBankCapital().then(res => {
      setParValue(res.data?.data?.par_value_per_share || 0);
    }).catch(() => {});
  }, []);

  // Advanced search state
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState(null);

  const fetchSimple = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getInvestments({ page, page_size: 20, search, payment_method: methodFilter, approval_status: statusFilter });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load'); }
    setLoading(false);
  }, [page, search, methodFilter, statusFilter]);

  const fetchAdvanced = useCallback(async (filters) => {
    setLoading(true);
    try {
      const res = await searchInvestmentsAdvanced({ filters, page, page_size: 20 });
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

  // alias kept so existing handlers (created on submit, etc.) still work
  const fetchData = () => { if (activeFilters) fetchAdvanced(activeFilters); else fetchSimple(); };

  // Dropdown label: "<account-no> / #<id> — <full name>". Backend search
  // matches first/middle/last name, account no, AND shareholder id.
  const shareholderOption = (s) => {
    const fullName = `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''}`
      .replace(/\s+/g, ' ').trim();
    return { value: s.id, label: `${s.account_no || '—'} / #${s.id} — ${fullName}` };
  };

  // Cache the default first-50 list so reset (on open / on clear) is instant.
  const defaultShListRef = useRef([]);
  const loadDefaultShareholders = async (force = false) => {
    if (!force && defaultShListRef.current.length) {
      setShareholders(defaultShListRef.current);
      return;
    }
    try {
      const res = await getShareholders({ page: 1, page_size: 50 });
      const opts = (res.data.data || []).map(shareholderOption);
      defaultShListRef.current = opts;
      setShareholders(opts);
    } catch { /* ignore */ }
  };

  // Debounced search — no backend call per keystroke; single char ignored;
  // clearing restores the full list (AntD v6 Select has no Enter hook).
  const shSearchTimerRef = useRef(null);
  const handleShareholderSearch = (val) => {
    if (shSearchTimerRef.current) clearTimeout(shSearchTimerRef.current);
    const q = (val || '').trim();
    if (!q) { loadDefaultShareholders(); return; }
    if (q.length < 2) return;
    shSearchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchShareholders(q);
        setShareholders((res.data.data || []).map(shareholderOption));
      } catch { setShareholders([]); }
    }, 450);
  };

  // Always reset to the full list on open so a previous search never lingers.
  const handleDropdownOpen = (open) => {
    if (open) loadDefaultShareholders();
  };

  const handleShareholderSelect = async (shId) => {
    setSummary(null);
    setSelectedAlloc(null);
    form.setFieldValue('allocation_id', undefined);
    if (!shId) return;
    setSummaryLoading(true);
    try {
      const res = await getShareholderInvestmentSummary(shId);
      setSummary(res.data);
      // Auto-pick the allocation when there's exactly one with remaining
      // capacity. Removes a click and forces strict per-allocation
      // validation on the only target the operator could've meant.
      const eligible = (res.data?.allocations || []).filter(
        a => a.payment_status !== 'fully_paid'
          && (a.allocated_shares - (a.paid_shares || 0) - (a.pending_shares || 0)) > 0
          && !subExpired(a)
      );
      if (eligible.length === 1) {
        form.setFieldValue('allocation_id', eligible[0].id);
        // Pass the fresh allocations so selectedAlloc is set immediately
        // (the `summary` state hasn't updated yet inside this callback).
        handleAllocationSelect(eligible[0].id, res.data?.allocations);
      }
    } catch { setSummary(null); }
    setSummaryLoading(false);
    // If "Dividend" is already the chosen method, refresh the source list.
    if (form.getFieldValue('payment_method') === 'dividend') loadShareholderDividends(shId);
  };

  // Load the shareholder's dividends that still have a reinvestable balance
  // (across all fiscal years — e.g. an uncollected 2025 plus 2026). Excludes
  // blocked / transferred dividends.
  const loadShareholderDividends = async (shId) => {
    if (!shId) { setShDividends([]); setSelectedDividend(null); return; }
    setDividendsLoading(true);
    try {
      const res = await getDividends({ shareholder_id: shId, page_size: 100 });
      const list = (res.data.data || []).filter(
        d => !d.is_blocked && !d.is_transferred && reinvestableOf(d) > 0.005,
      );
      setShDividends(list);
      // Auto-select when there's only one source.
      if (list.length === 1) {
        setSelectedDividend(list[0]);
        form.setFieldValue('dividend_source', list[0].id);
      } else {
        setSelectedDividend(null);
        form.setFieldValue('dividend_source', undefined);
      }
    } catch { setShDividends([]); setSelectedDividend(null); }
    setDividendsLoading(false);
  };

  // When the payment method changes to/from Dividend, load or clear the
  // dividend source list.
  const handlePaymentMethodChange = (method) => {
    if (method === 'dividend') {
      loadShareholderDividends(form.getFieldValue('shareholder_id'));
    } else {
      setShDividends([]);
      setSelectedDividend(null);
      form.setFieldsValue({ dividend_source: undefined, div_reinvest_amount: undefined, div_additional_amount: undefined });
    }
  };

  // allocs override lets callers (e.g. the auto-select right after fetching
  // the summary) pass the freshly-loaded allocations, avoiding the stale
  // `summary` closure that left selectedAlloc null on auto-pick.
  const handleAllocationSelect = (allocId, allocs) => {
    const list = allocs || summary?.allocations;
    if (!allocId || !list) {
      setSelectedAlloc(null);
      return;
    }
    const alloc = list.find(a => a.id === allocId);
    if (!alloc) {
      setSelectedAlloc(null);
      return;
    }
    setSelectedAlloc(alloc);
    const remaining = alloc.remaining_amount > 0 ? alloc.remaining_amount : alloc.allocated_amount;
    const remainingShares = alloc.allocated_shares - alloc.paid_shares;
    form.setFieldsValue({
      amount: remaining > 0 ? remaining : undefined,
      number_of_shares: remainingShares > 0 ? remainingShares : undefined,
    });
    lastChanged.current = null;
    // Re-validate any already-entered values against the new cap
    form.validateFields(['amount', 'number_of_shares']).catch(() => {});
  };

  // Caps used by Form.Item validators below. When an allocation is selected,
  // subtract BOTH paid and pending so a second pending submission can't slip
  // through while the first one is still awaiting approval. When no
  // allocation is picked, fall back to the shareholder's total outstanding
  // balance minus all the shareholder's pending investments.
  const totalPending = (summary?.allocations || []).reduce(
    (s, a) => s + (a.pending_amount || 0), 0);
  const totalPendingShares = (summary?.allocations || []).reduce(
    (s, a) => s + (a.pending_shares || 0), 0);
  const capAmount = selectedAlloc
    ? Math.max(0, (selectedAlloc.remaining_amount || 0) - (selectedAlloc.pending_amount || 0))
    : (summary?.outstanding_balance > 0 ? Math.max(0, summary.outstanding_balance - totalPending) : null);
  const capShares = selectedAlloc
    ? Math.max(0, (selectedAlloc.allocated_shares || 0)
                  - (selectedAlloc.paid_shares || 0)
                  - (selectedAlloc.pending_shares || 0))
    : (summary?.total_allocated_shares > 0
        ? Math.max(0, summary.total_allocated_shares - summary.total_shares_paid - totalPendingShares)
        : null);

  const handlePaymentDateChange = (date) => {
    if (date) {
      form.setFieldsValue({ amharic_date: formatEthiopianDate(date.year(), date.month() + 1, date.date()) });
    }
  };

  const handleAmountChange = (val) => {
    if (lastChanged.current === 'shares') return;
    lastChanged.current = 'amount';
    form.setFieldValue('number_of_shares', val > 0 && parValue > 0 ? Math.floor(val / parValue) : 0);
    lastChanged.current = null;
  };

  const handleSharesChange = (val) => {
    if (lastChanged.current === 'amount') return;
    lastChanged.current = 'shares';
    form.setFieldValue('amount', val > 0 && parValue > 0 ? val * parValue : 0);
    lastChanged.current = null;
  };

  const openModal = () => {
    form.resetFields();
    form.setFieldValue('par_value', parValue);
    setSummary(null);
    setSelectedAlloc(null);
    setShareholders([]);
    setShDividends([]);
    setSelectedDividend(null);
    lastChanged.current = null;
    setModalOpen(true);
  };

  const closeInvestmentModal = () => {
    setModalOpen(false);
    form.resetFields();
    setSummary(null);
    setSelectedAlloc(null);
    setAllocDetailOpen(false);
    setShDividends([]);
    setSelectedDividend(null);
  };

  const handleSubmit = async (values) => {
    // ── Dividend-as-payment path ────────────────────────────────────────
    // Reuse the dividend "reinvest" engine: fund the chosen allocation's
    // unpaid shares from a selected dividend (+ optional cash top-up). No new
    // allocation is created; the dividend ledger (reinvested/tax/uncollected)
    // is recomputed server-side.
    if (values.payment_method === 'dividend') {
      if (!selectedDividend) { message.error('Pick a dividend source to reinvest from.'); return; }
      if (!values.allocation_id) { message.error('Pick the allocation this dividend should pay down (above).'); return; }
      const reinv = Number(values.div_reinvest_amount || 0);
      const addl = Number(values.div_additional_amount || 0);
      const combined = reinv + addl;
      if (parValue <= 0) { message.error('Par value is not configured.'); return; }
      const shares = Math.floor(combined / parValue);
      if (shares <= 0) { message.error('The combined amount is less than one whole share.'); return; }
      const cap = selectedAlloc
        ? Math.max(0, (selectedAlloc.allocated_shares || 0) - (selectedAlloc.paid_shares || 0) - (selectedAlloc.pending_shares || 0))
        : 0;
      if (shares > cap) {
        message.error(`This would buy ${shares.toLocaleString()} shares but the allocation only has ${cap.toLocaleString()} unpaid. Reduce the amount.`);
        return;
      }
      // Snap funding so reinvest + additional == shares × par exactly (backend
      // requires the funding to match the distributed shares).
      const used = shares * parValue;
      const reinvestUsed = Math.min(reinv, used);
      const additionalUsed = used - reinvestUsed;
      try {
        await reinvestDividend(selectedDividend.id, {
          reinvest_amount: reinvestUsed,
          additional_amount: additionalUsed,
          additional_payment_method: values.div_additional_method || 'cash',
          reference_no: values.reference_no || '',
          from_account: values.from_account || '',
          remark: values.remark || '',
          distributions: [{ allocation_id: values.allocation_id, shares }],
        });
        message.success('Reinvested from dividend — investment created (pending approval). No new allocation made.');
        closeInvestmentModal();
        fetchData();
      } catch (err) {
        message.error(err.response?.data?.error || 'Reinvest failed');
      }
      return;
    }

    // ── Normal cash/bank/check/cpo path (unchanged) ─────────────────────
    try {
      if (values.payment_date) values.payment_date = values.payment_date.toISOString();
      await createInvestment(values);
      message.success('Investment recorded, pending approval');
      closeInvestmentModal();
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const allocColumns = [
    { title: 'Alloc No', dataIndex: 'allocation_no', width: 110 },
    { title: 'Rnd', dataIndex: 'round', width: 45 },
    {
      title: 'Allocated', key: 'allocated',
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{formatCurrency(r.allocated_amount)}</div>
          <div style={{ color: '#888', fontSize: 11 }}>{r.allocated_shares?.toLocaleString()} shares</div>
        </div>
      ),
    },
    {
      title: 'Paid', key: 'paid',
      render: (_, r) => (
        <div>
          <div style={{ color: '#52c41a', fontWeight: 500 }}>{formatCurrency(r.paid_amount)}</div>
          <div style={{ color: '#888', fontSize: 11 }}>{r.paid_shares?.toLocaleString()} shares</div>
        </div>
      ),
    },
    {
      title: 'Remaining', key: 'remaining',
      render: (_, r) => (
        <div>
          <div style={{ color: r.remaining_amount > 0 ? '#f5222d' : '#52c41a', fontWeight: 500 }}>
            {formatCurrency(r.remaining_amount)}
          </div>
          <div style={{ color: '#888', fontSize: 11 }}>
            {(r.allocated_shares - r.paid_shares)?.toLocaleString()} shares
          </div>
        </div>
      ),
    },
    {
      title: 'Payment Status', dataIndex: 'payment_status', width: 120,
      render: (s) => (
        <Tag icon={statusIcons[s]} color={statusColors[s]}>
          {statusLabels[s] || s}
        </Tag>
      ),
    },
    { title: 'Type', dataIndex: 'subscription_type', width: 90, render: (v) => v ? <Tag color="blue">{v}</Tag> : '-' },
  ];

  const columns = [
    { title: 'Sh. ID', key: 'shid', width: 75, render: (_, r) => r.shareholder_id ?? r.shareholder?.id ?? '-' },
    {
      title: 'Shareholder', key: 'sh',
      render: (_, r) => r.shareholder ? `${r.shareholder.account_no} - ${r.shareholder.first_name} ${r.shareholder.last_name}` : '-',
    },
    { title: 'Date', dataIndex: 'payment_date', width: 105, render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
    {
      title: 'Eth. Date', dataIndex: 'amharic_date', width: 115,
      render: (v, r) => {
        if (v) return v;
        if (r.payment_date) {
          const d = dayjs(r.payment_date);
          return <Tooltip title="Auto-calculated">{formatEthiopianDate(d.year(), d.month() + 1, d.date())}</Tooltip>;
        }
        return '-';
      },
    },
    { title: 'Method', dataIndex: 'payment_method', width: 110 },
    { title: 'From Account', dataIndex: 'from_account', width: 130, render: (v) => v || '-' },
    { title: 'Amount', dataIndex: 'amount', render: (v) => formatCurrency(v) },
    { title: 'Shares', dataIndex: 'number_of_shares', width: 80 },
    { title: 'Par Value', dataIndex: 'par_value', width: 110, render: (v) => formatCurrency(v) },
    { title: 'Ref No', dataIndex: 'reference_no', width: 110, render: (v) => v || '-' },
    {
      title: 'Approval', dataIndex: 'approval_status', width: 95,
      render: (s, r) => {
        const color = s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange';
        const tag = <Tag color={color}>{s}</Tag>;
        return s === 'rejected' && r.rejection_reason
          ? <Tooltip title={r.rejection_reason} placement="left">{tag}</Tooltip>
          : tag;
      },
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Investments</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openModal}>New Investment</Button>
      </Row>

      {/* Search & Filter bar */}
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
            placeholder="Filter by method"
            allowClear
            style={{ width: '100%' }}
            options={paymentMethods}
            disabled={!!activeFilters}
            onChange={(v) => { setMethodFilter(v || ''); setPage(1); }}
          />
        </Col>
        <Col span={4}>
          <Select
            placeholder="Filter by approval"
            allowClear
            style={{ width: '100%' }}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
            ]}
            disabled={!!activeFilters}
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
        fields={INV_FIELDS}
        open={advancedOpen}
        onSearch={runAdvancedSearch}
        onReset={resetAdvancedSearch}
      />

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage, showTotal: (t) => `Total ${t}` }}
        scroll={{ x: 1400 }} />

      {/* Create Modal */}
      <Modal title="Record Investment" open={modalOpen} onCancel={() => { closeInvestmentModal(); }}
        footer={null} width={780}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>

          {/* Shareholder selector */}
          <Form.Item name="shareholder_id" label="Shareholder" rules={[{ required: true }]}>
            <Select
              showSearch allowClear filterOption={false}
              onSearch={handleShareholderSearch}
              options={shareholders}
              onDropdownVisibleChange={handleDropdownOpen}
              onChange={handleShareholderSelect}
              onClear={() => loadDefaultShareholders()}
              notFoundContent="Type 2+ characters of a name, account no, or ID to search"
              placeholder="Search by name, account no, or ID…"
            />
          </Form.Item>

          {/* Shareholder summary card */}
          {summaryLoading && <Spin style={{ display: 'block', margin: '8px auto 16px' }} />}
          {summary && !summaryLoading && (
            <Card
              size="small"
              style={{ marginBottom: 16, background: '#fafafa', border: '1px solid #e8e8e8' }}
              title={
                <Space>
                  <Text strong>Shareholder Summary</Text>
                  <Tag icon={statusIcons[summary.payment_status]} color={statusColors[summary.payment_status]}>
                    {statusLabels[summary.payment_status]}
                  </Tag>
                </Space>
              }
            >
              <Row gutter={16} style={{ marginBottom: 8 }}>
                <Col span={6}>
                  <Text type="secondary" style={{ fontSize: 11 }}>SUBSCRIBED</Text>
                  <div><Text strong>{formatCurrency(summary.total_subscribed)}</Text></div>
                  <Text type="secondary" style={{ fontSize: 11 }}>{summary.total_subscribed_shares?.toLocaleString()} shares</Text>
                </Col>
                <Col span={6}>
                  <Text type="secondary" style={{ fontSize: 11 }}>ALLOCATED</Text>
                  <div><Text strong>{formatCurrency(summary.total_allocated_amount)}</Text></div>
                  <Text type="secondary" style={{ fontSize: 11 }}>{summary.total_allocated_shares?.toLocaleString()} shares</Text>
                </Col>
                <Col span={6}>
                  <Text type="secondary" style={{ fontSize: 11 }}>PAID</Text>
                  <div><Text strong style={{ color: '#52c41a' }}>{formatCurrency(summary.total_paid)}</Text></div>
                  <Text type="secondary" style={{ fontSize: 11 }}>{summary.total_shares_paid?.toLocaleString()} shares</Text>
                </Col>
                <Col span={6}>
                  <Text type="secondary" style={{ fontSize: 11 }}>OUTSTANDING</Text>
                  <div>
                    <Text strong style={{ color: summary.outstanding_balance > 0 ? '#f5222d' : '#52c41a' }}>
                      {formatCurrency(summary.outstanding_balance)}
                    </Text>
                  </div>
                </Col>
              </Row>
              {summary.allocations?.length > 0 && (
                <>
                  <Divider style={{ margin: '8px 0' }} />
                  <Row justify="space-between" align="middle">
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {summary.allocations.length} allocation{summary.allocations.length === 1 ? '' : 's'}
                    </Text>
                    {/* Per-allocation breakdown lives in a modal so a shareholder
                        with many allocations doesn't bloat the form. */}
                    <Button size="small" onClick={() => setAllocDetailOpen(true)}>
                      View allocation detail
                    </Button>
                  </Row>
                </>
              )}
            </Card>
          )}

          {/* Allocation selector — only show unpaid/partially paid allocations.
              Required when any eligible allocation exists, so the strict
              per-allocation cap is always enforced; the unlinked fallback
              only triggers when the shareholder genuinely has no allocations
              yet. */}
          {summary?.allocations?.filter(a => a.payment_status !== 'fully_paid').length > 0 && (
            <Form.Item
              name="allocation_id"
              label="Allocation (which allocation is this payment for?)"
              rules={[{ required: true, message: 'Pick the allocation this payment applies to.' }]}
              tooltip="The payment will be capped at this allocation's remaining shares + pending."
            >
              <Select
                placeholder="Select allocation..."
                allowClear
                onChange={handleAllocationSelect}
                options={summary.allocations
                  .filter(a => a.payment_status !== 'fully_paid')
                  .map(a => {
                    const remShares = Math.max(0, (a.allocated_shares || 0) - (a.paid_shares || 0) - (a.pending_shares || 0));
                    const remAmount = Math.max(0, (a.remaining_amount || 0) - (a.pending_amount || 0));
                    const pendingHint = a.pending_shares > 0 ? ` · ${a.pending_shares} pending` : '';
                    const expired = subExpired(a);
                    return {
                      value: a.id,
                      disabled: expired,
                      label: `${a.allocation_no} | Round ${a.round}${a.subscription_type ? ` | ${a.subscription_type}` : ''} | ${remShares.toLocaleString()} shares left${pendingHint} | ${formatCurrency(remAmount)} [${expired ? `EXPIRED ${dayjs(a.subscription_expiry).format('YYYY-MM-DD')} — extend first` : statusLabels[a.payment_status] || a.payment_status}]`,
                    };
                  })}
              />
            </Form.Item>
          )}

          {/* Payment details */}
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="payment_date" label="Payment Date" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} onChange={handlePaymentDateChange} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="amharic_date" label="Ethiopian Date (Auto-filled)"
                tooltip="Auto-converted. You can override.">
                <Input placeholder="Auto-fills from date" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="payment_method" label="Payment Method" rules={[{ required: true }]}>
                <Select options={paymentMethods} onChange={handlePaymentMethodChange} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              {/* Label/placeholder of the From-Account field changes based on
                  Payment Method so the operator types the right value for the
                  chosen channel. The underlying field is still `from_account`
                  (a free-text string), so no backend / schema change. */}
              <Form.Item dependencies={['payment_method']} noStyle>
                {({ getFieldValue }) => {
                  const m = getFieldValue('payment_method');
                  const cfg = {
                    cash:          { label: 'Received By / Branch',  placeholder: 'Cashier name or branch…',         tooltip: 'Who received the cash, or which branch.' },
                    bank_transfer: { label: 'From Bank Account',     placeholder: 'Bank name + account no…',          tooltip: 'Originating bank + account that wired the funds.' },
                    check:         { label: 'Check Drawer / Bank',   placeholder: 'Drawer name or issuing bank…',     tooltip: 'Who signed the check / which bank issued it.' },
                    cpo:           { label: 'CPO Issuer / Bank',     placeholder: 'CPO issuing bank…',                tooltip: 'Which bank issued the CPO.' },
                    dividend:      { label: 'From Dividend',         placeholder: 'Auto-linked dividend',             tooltip: 'Source dividend (linked automatically when reinvesting).' },
                  }[m] || { label: 'From Account / CPO No', placeholder: 'Account no or reference…', tooltip: 'Bank account, CPO number, or transfer reference.' };
                  return (
                    <Form.Item name="from_account" label={cfg.label} tooltip={cfg.tooltip}>
                      <Input placeholder={cfg.placeholder} />
                    </Form.Item>
                  );
                }}
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item dependencies={['payment_method']} noStyle>
                {({ getFieldValue }) => {
                  const m = getFieldValue('payment_method');
                  const cfg = {
                    cash:          { label: 'Receipt No',         placeholder: 'Cash receipt no…' },
                    bank_transfer: { label: 'Bank Reference No',  placeholder: 'Bank slip / transaction id…' },
                    check:         { label: 'Check No',           placeholder: 'Check number…' },
                    cpo:           { label: 'CPO No',             placeholder: 'CPO number…' },
                    dividend:      { label: 'Dividend Ref',       placeholder: 'Auto-set' },
                  }[m] || { label: 'Bank Reference No', placeholder: 'Bank slip / receipt no…' };
                  return (
                    <Form.Item name="reference_no" label={cfg.label}>
                      <Input placeholder={cfg.placeholder} />
                    </Form.Item>
                  );
                }}
              </Form.Item>
            </Col>
          </Row>

          {watchedMethod === 'dividend' ? (() => {
            const reinv = Number(watchedDivReinvest || 0);
            const addl = Number(watchedDivAdditional || 0);
            const combined = reinv + addl;
            const shares = parValue > 0 ? Math.floor(combined / parValue) : 0;
            const used = shares * parValue;
            const residual = combined - used;
            const reinvestable = reinvestableOf(selectedDividend);
            const allocCap = selectedAlloc
              ? Math.max(0, (selectedAlloc.allocated_shares || 0) - (selectedAlloc.paid_shares || 0) - (selectedAlloc.pending_shares || 0))
              : 0;
            const overCap = shares > allocCap;
            return (
              <>
                <Divider style={{ margin: '4px 0 12px' }}>Reinvest from Dividend</Divider>
                {dividendsLoading ? <Spin /> : shDividends.length === 0 ? (
                  <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                    message="No uncollected dividend to reinvest"
                    description="This shareholder has no dividend with a reinvestable balance. Choose a different payment method." />
                ) : (
                  <>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="dividend_source" label="Dividend Source"
                          rules={[{ required: true, message: 'Pick which dividend to reinvest from' }]}
                          tooltip="The shareholder may have uncollected dividends across fiscal years — pick which one funds this.">
                          <Select
                            placeholder="Select dividend…"
                            onChange={(id) => {
                              const d = shDividends.find(x => x.id === id);
                              setSelectedDividend(d || null);
                              const r = reinvestableOf(d);
                              const outstanding = selectedAlloc ? Math.max(0, selectedAlloc.remaining_amount || 0) : r;
                              form.setFieldValue('div_reinvest_amount', Math.min(r, outstanding || r));
                            }}
                            options={shDividends.map(d => ({
                              value: d.id,
                              label: `FY ${d.fiscal_year} — reinvestable ${formatCurrency(reinvestableOf(d))}`,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <div style={{ paddingTop: 30 }}>
                          {selectedDividend && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              Reinvestable from FY {selectedDividend.fiscal_year}: <Text strong>{formatCurrency(reinvestable)}</Text>
                            </Text>
                          )}
                        </div>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col span={8}>
                        <Form.Item name="div_reinvest_amount" label="Amount to Reinvest from Dividend"
                          tooltip="Removed from the dividend's taxable gross — no dividend tax on this portion."
                          rules={[
                            { required: true, message: 'Required' },
                            { validator: (_, v) => {
                                if (v == null) return Promise.resolve();
                                if (v > reinvestable + 0.01) return Promise.reject(new Error(`Max reinvestable: ${formatCurrency(reinvestable)}`));
                                return Promise.resolve();
                              } },
                          ]}>
                          <InputNumber style={{ width: '100%' }} min={0} max={reinvestable}
                            formatter={(v) => v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                            parser={(v) => v.replace(/,/g, '')} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="div_additional_amount" label="Additional Amount (top-up)"
                          tooltip="Optional cash/bank money so dividend + top-up fully pays the allocation.">
                          <InputNumber style={{ width: '100%' }} min={0}
                            formatter={(v) => v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                            parser={(v) => v.replace(/,/g, '')} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="div_additional_method" label="Top-up Method" initialValue="cash">
                          <Select options={paymentMethods.filter(p => p.value !== 'dividend')} />
                        </Form.Item>
                      </Col>
                    </Row>
                    {/* Computed, read-only: whole shares the funds buy and the
                        exact amount used (floor of (reinvest + top-up) ÷ par). */}
                    <Row gutter={16}>
                      <Col span={8}>
                        <Form.Item label={
                          <Space size={4}>
                            <span>Number of Shares</span>
                            {selectedAlloc && (
                              <Tag color={overCap ? 'red' : 'blue'} style={{ fontSize: 10 }}>
                                max {allocCap.toLocaleString()}
                              </Tag>
                            )}
                          </Space>
                        } tooltip="Whole shares this reinvest + top-up will pay down on the allocation (floor of total ÷ par value).">
                          <InputNumber style={{ width: '100%' }} value={shares} disabled
                            status={overCap ? 'error' : ''} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item label="Amount Used (ETB)" tooltip="Number of shares × par value — what's actually applied.">
                          <InputNumber style={{ width: '100%' }} value={used} disabled
                            formatter={(v) => v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '0'} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item label="Par Value">
                          <InputNumber style={{ width: '100%' }} value={parValue} disabled />
                        </Form.Item>
                      </Col>
                    </Row>
                    {shares > 0 ? (
                      <Alert
                        type={overCap ? 'error' : residual > 0.005 ? 'warning' : 'success'}
                        showIcon style={{ marginBottom: 12 }}
                        message={overCap
                          ? `${shares.toLocaleString()} shares exceeds the allocation's ${allocCap.toLocaleString()} unpaid shares — reduce the amount`
                          : `Will pay down ${shares.toLocaleString()} share${shares === 1 ? '' : 's'} (ETB ${used.toLocaleString(undefined, { minimumFractionDigits: 2 })}) on ${selectedAlloc?.allocation_no || 'the selected allocation'}`}
                        description={
                          <div style={{ fontSize: 12 }}>
                            <div>From dividend: <Text strong>{formatCurrency(Math.min(reinv, used))}</Text>{addl > 0 ? <> · top-up: <Text strong>{formatCurrency(Math.max(0, used - Math.min(reinv, used)))}</Text></> : null}</div>
                            {residual > 0.005 && <div><Text type="warning">ETB {residual.toFixed(2)} unused</Text> — doesn't complete another whole share.</div>}
                            <div><Text type="secondary">Dividend tax is recalculated; the investment is created pending approval.</Text></div>
                          </div>
                        }
                      />
                    ) : (
                      <Alert type="info" showIcon style={{ marginBottom: 12 }}
                        message="Enter a reinvest and/or top-up amount that adds up to at least one whole share." />
                    )}
                  </>
                )}
              </>
            );
          })() : (
          <>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="amount"
                label={
                  <Space size={4}>
                    <span>Amount (ETB)</span>
                    {capAmount !== null && capAmount >= 0 && (
                      <Tag color={capAmount > 0 ? 'blue' : 'red'} style={{ fontSize: 10, marginLeft: 4 }}>
                        max {formatCurrency(capAmount)}
                      </Tag>
                    )}
                  </Space>
                }
                rules={[
                  { required: true },
                  {
                    validator: (_, v) => {
                      if (v == null) return Promise.resolve();
                      // Whole shares only: the amount must be an exact multiple
                      // of the par value — at least one share (>= par), and no
                      // fraction (e.g. reject 600 and 1,500 when par is 1,000).
                      if (parValue > 0) {
                        if (v < parValue) {
                          return Promise.reject(new Error(
                            `Amount must be at least one share — par value ${formatCurrency(parValue)}.`
                          ));
                        }
                        const k = v / parValue;
                        if (Math.abs(k - Math.round(k)) > 1e-6) {
                          const lo = Math.floor(k) * parValue;
                          const hi = Math.ceil(k) * parValue;
                          return Promise.reject(new Error(
                            `Whole shares only — amount must be an exact multiple of the par value ${formatCurrency(parValue)}. ${formatCurrency(v)} = ${k.toFixed(2)} shares; use ${formatCurrency(lo)} or ${formatCurrency(hi)}.`
                          ));
                        }
                      }
                      if (capAmount !== null && capAmount >= 0 && v > capAmount + 0.01) {
                        return Promise.reject(new Error(
                          selectedAlloc
                            ? `Exceeds allocation cap. Max for ${selectedAlloc.allocation_no}: ${formatCurrency(capAmount)}`
                            : `Exceeds outstanding balance. Max: ${formatCurrency(capAmount)}`
                        ));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }} min={0}
                  formatter={(v) => v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                  parser={(v) => v.replace(/,/g, '')}
                  onChange={handleAmountChange}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="par_value" label="Par Value (from settings)">
                <InputNumber style={{ width: '100%' }} disabled />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="premium_value" label="Premium Value">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="number_of_shares"
                label={
                  <Space size={4}>
                    <span>Number of Shares</span>
                    {capShares !== null && capShares >= 0 && (
                      <Tag color={capShares > 0 ? 'blue' : 'red'} style={{ fontSize: 10, marginLeft: 4 }}>
                        max {capShares.toLocaleString()}
                      </Tag>
                    )}
                  </Space>
                }
                rules={[
                  {
                    validator: (_, v) => {
                      if (v == null) return Promise.resolve();
                      if (capShares !== null && capShares >= 0 && v > capShares) {
                        return Promise.reject(new Error(
                          selectedAlloc
                            ? `Exceeds allocation cap. Max for ${selectedAlloc.allocation_no}: ${capShares.toLocaleString()} shares`
                            : `Exceeds remaining unallocated. Max: ${capShares.toLocaleString()} shares`
                        ));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <InputNumber style={{ width: '100%' }} min={0} precision={0} onChange={handleSharesChange} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="is_standing" label="Standing Instruction" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          </>
          )}

          <Form.Item name="remark" label="Remark">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => { closeInvestmentModal(); }}>Cancel</Button>
              <Button type="primary" htmlType="submit">Record</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Per-allocation detail — opened from the summary card. Paginated so a
          shareholder with many (e.g. 100) allocations stays manageable. */}
      <Modal
        title={`Allocation Detail${summary?.shareholder ? ` — ${summary.shareholder.first_name || ''} ${summary.shareholder.last_name || ''}`.replace(/\s+$/, '') : ''}`}
        open={allocDetailOpen}
        onCancel={() => setAllocDetailOpen(false)}
        footer={<Button onClick={() => setAllocDetailOpen(false)}>Close</Button>}
        width={900}
      >
        <Table
          dataSource={summary?.allocations || []}
          columns={allocColumns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50],
            showTotal: (t) => `${t} allocation${t === 1 ? '' : 's'}` }}
          scroll={{ x: 700 }}
        />
      </Modal>
    </div>
  );
}
