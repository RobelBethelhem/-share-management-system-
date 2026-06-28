import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker,
  Space, Tag, Tooltip, message, Typography, Row, Col, Switch, Card, Divider, Spin, Radio,
} from 'antd';
import {
  PlusOutlined, InfoCircleOutlined, SearchOutlined, FilterOutlined,
  CheckCircleOutlined, ClockCircleOutlined, MinusCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getTransfers, createTransfer, calculateTransferFees, searchShareholders,
  getShareholders, getShareholderInvestmentSummary, getShareBlocks, getBankCapital,
  searchTransfersAdvanced, getInvestments,
} from '../services/api';
import { formatCurrency, formatNumber, transferTypes } from '../utils/format';
import AdvancedSearchPanel from '../components/AdvancedSearchPanel';

const TRF_FIELDS = [
  { key: 'id',                 label: 'Transfer ID',         type: 'int' },
  { key: 'batch_no',           label: 'Batch No',            type: 'string' },
  { key: 'transferor_id',      label: 'Transferor (Sh. ID)', type: 'int' },
  { key: 'transferee_id',      label: 'Transferee (Sh. ID)', type: 'int' },
  { key: 'transfer_type',      label: 'Transfer Type',       type: 'enum', options: transferTypes },
  { key: 'number_of_shares',   label: 'Number of Shares',    type: 'int' },
  { key: 'par_value',          label: 'Par Value',           type: 'number' },
  { key: 'transfer_amount',    label: 'Transfer Amount',     type: 'number' },
  { key: 'capital_gain_tax',   label: 'Capital Gain Tax',    type: 'number' },
  { key: 'service_fee',        label: 'Service Fee',         type: 'number' },
  { key: 'stamp_duty',         label: 'Stamp Duty',          type: 'number' },
  { key: 'vat',                label: 'VAT',                 type: 'number' },
  { key: 'total_fees',         label: 'Total Fees',          type: 'number' },
  { key: 'is_full_transfer',   label: 'Full Transfer',       type: 'bool' },
  { key: 'include_subscribed', label: 'Include Subscribed',  type: 'bool' },
  { key: 'reason',             label: 'Reason',              type: 'string' },
  { key: 'status',             label: 'Status',              type: 'enum', options: [{value:'pending',label:'Pending'},{value:'completed',label:'Completed'}] },
  { key: 'approval_status',    label: 'Approval Status',     type: 'enum', options: [{value:'pending',label:'Pending'},{value:'approved',label:'Approved'},{value:'rejected',label:'Rejected'}] },
  { key: 'transfer_date',      label: 'Transfer Date',       type: 'date' },
  { key: 'created_at',         label: 'Created Date',        type: 'date' },
];

const { Title, Text } = Typography;

const statusColors = { fully_paid: 'green', partially_paid: 'orange', not_started: 'default' };
const statusLabels = { fully_paid: 'Fully Paid', partially_paid: 'Partially Paid', not_started: 'Not Started' };
const statusIcons = {
  fully_paid: <CheckCircleOutlined />,
  partially_paid: <ClockCircleOutlined />,
  not_started: <MinusCircleOutlined />,
};
const blockTypeColors = { court_order: 'red', collateral: 'orange', pledge: 'gold', other: 'default' };

export default function Transfers() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [shareholders, setShareholders] = useState([]);
  const [fees, setFees] = useState(null);
  const [parValue, setParValue] = useState(0);
  const [form] = Form.useForm();

  // Transferor summary state
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [transferorSummary, setTransferorSummary] = useState(null);
  const [transferorBlocks, setTransferorBlocks] = useState([]);
  const [allocTransfers, setAllocTransfers] = useState({});

  // Per-line state (keyed by field.key)
  const [lineAllocs, setLineAllocs] = useState({});
  const [lineModes, setLineModes] = useState({});
  // Selected source cohort per line (a specific payment, the whole paid pool,
  // or the unpaid pool of an allocation). Drives the dividend-from floor.
  const [lineCohorts, setLineCohorts] = useState({});
  // The transferor's positive paid investments (payments), for cohort listing.
  const [transferorPayments, setTransferorPayments] = useState([]);

  // Transferee summary for destination matching
  const [transfereeSummary, setTransfereeSummary] = useState(null);
  const [transfereeSummaryLoading, setTransfereeSummaryLoading] = useState(false);

  // Destination mode
  const [destMode, setDestMode] = useState('new');
  const [destSuggestion, setDestSuggestion] = useState(null);

  // Stable ref for field key → index mapping (needed in handleLineModeChange)
  const fieldKeysRef = useRef([]);

  // Transferor allocations/blocks detail modal (kept out of the form by default).
  const [transferorDetailOpen, setTransferorDetailOpen] = useState(false);

  // Watch the two party ids so each Select can exclude the other party.
  const watchedTransferor = Form.useWatch('transferor_id', form);
  const watchedTransferee = Form.useWatch('transferee_id', form);

  // Fetch par value from bank capital settings
  useEffect(() => {
    getBankCapital().then(res => {
      setParValue(res.data?.data?.par_value_per_share || 0);
    }).catch(() => {});
  }, []);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState(null);

  const fetchSimple = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTransfers({ page, page_size: 20, search, transfer_type: typeFilter, approval_status: statusFilter });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load'); }
    setLoading(false);
  }, [page, search, typeFilter, statusFilter]);

  const fetchAdvanced = useCallback(async (filters) => {
    setLoading(true);
    try {
      const res = await searchTransfersAdvanced({ filters, page, page_size: 20 });
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

  // Dropdown label: "<account-no> / #<id> — <full name>" (first+middle+last).
  // Backend quick-search matches name, account no, AND shareholder id.
  const shareholderOption = (s) => {
    const fullName = `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''}`
      .replace(/\s+/g, ' ').trim();
    return { value: s.id, label: `${s.account_no || '—'} / #${s.id} — ${fullName}` };
  };

  // Cache the default first-50 list so reset (on open / on clear) is instant.
  const defaultShListRef = useRef([]);
  const loadDefaultShareholders = async () => {
    if (defaultShListRef.current.length) { setShareholders(defaultShListRef.current); return; }
    try {
      const res = await getShareholders({ page: 1, page_size: 50 });
      const opts = (res.data.data || []).map(shareholderOption);
      defaultShListRef.current = opts;
      setShareholders(opts);
    } catch { /* ignore */ }
  };

  // Debounced search (no per-keystroke calls; single char ignored; clearing
  // restores the full list — AntD v6 Select has no Enter hook).
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

  // Reset to the full list on open so a previous search never lingers.
  const handleDropdownOpen = (open) => {
    if (open) loadDefaultShareholders();
  };

  const resetLineState = () => {
    setLineAllocs({});
    setLineModes({});
    setLineCohorts({});
  };

  // Build the selectable source cohorts for the transferor: each individual
  // paid payment (with its own date → its own dividend-from floor), a
  // whole-allocation "All paid" pool (covers the unlinked pool / legacy), and
  // the unpaid (subscribed) pool. Caps respect blocks via the allocation's
  // available paid/unpaid (same math the per-line card used before).
  const cohortsForTransferor = () => {
    const allocs = transferorSummary?.allocations || [];
    const out = [];
    for (const a of allocs) {
      const paid = a.paid_shares || 0;
      const unpaid = Math.max(0, (a.allocated_shares || 0) - paid);
      const totalBlocked = a.blocked_shares || 0;
      const totalFree = Math.max(0, (a.allocated_shares || 0) - totalBlocked);
      const availPaid = Math.max(0, Math.min(paid - (a.paid_blocked_shares || 0), totalFree));
      const availUnpaid = Math.max(0, Math.min(unpaid - (a.unpaid_blocked_shares || 0), totalFree));
      const acq = a.acquisition_date || a.allocation_date;
      const pays = (transferorPayments || [])
        .filter(p => p.allocation_id === a.id && (p.number_of_shares || 0) > 0)
        .sort((x, y) => dayjs(x.payment_date).valueOf() - dayjs(y.payment_date).valueOf());
      for (const p of pays) {
        const cap = Math.min(p.number_of_shares, availPaid);
        if (cap <= 0) continue;
        out.push({
          key: `paid-${p.id}`, kind: 'paid', allocationId: a.id, allocationNo: a.allocation_no,
          round: a.round, investmentId: p.id, date: p.payment_date, shares: cap,
          label: `${a.allocation_no} · Payment ${dayjs(p.payment_date).format('YYYY-MM-DD')} · ${(p.number_of_shares).toLocaleString()} sh${p.payment_method ? ` (${p.payment_method})` : ''}${cap < p.number_of_shares ? ` — ${cap.toLocaleString()} avail` : ''}`,
        });
      }
      if (availPaid > 0) {
        out.push({
          key: `allpaid-${a.id}`, kind: 'allpaid', allocationId: a.id, allocationNo: a.allocation_no,
          round: a.round, investmentId: null, date: acq, shares: availPaid,
          label: `${a.allocation_no} · All paid · ${availPaid.toLocaleString()} sh${acq ? ` · since ${dayjs(acq).format('YYYY-MM-DD')}` : ''}`,
        });
      }
      if (availUnpaid > 0) {
        out.push({
          key: `unpaid-${a.id}`, kind: 'unpaid', allocationId: a.id, allocationNo: a.allocation_no,
          round: a.round, investmentId: null, date: acq, shares: availUnpaid,
          label: `${a.allocation_no} · Unpaid (subscribed) · ${availUnpaid.toLocaleString()} sh`,
        });
      }
    }
    return out;
  };

  const onCohortChange = (field, cohortKey, cohorts) => {
    const cohort = cohorts.find(c => c.key === cohortKey) || null;
    if (!cohort) return;
    const a = (transferorSummary?.allocations || []).find(x => x.id === cohort.allocationId) || null;
    const newLineAllocs = { ...lineAllocs, [field.key]: a };
    setLineAllocs(newLineAllocs);
    setLineCohorts(prev => ({ ...prev, [field.key]: cohort }));
    setLineModes(prev => ({ ...prev, [field.key]: cohort.kind === 'unpaid' ? 'unpaid_only' : 'paid_only' }));
    form.setFieldValue(['lines', field.name, 'from_allocation_id'], cohort.allocationId);
    // Reset both share fields; the user fills only the active one.
    form.setFieldValue(['lines', field.name, 'paid_shares_to_transfer'], cohort.kind === 'unpaid' ? 0 : undefined);
    form.setFieldValue(['lines', field.name, 'unpaid_shares_to_transfer'], cohort.kind === 'unpaid' ? undefined : 0);
    updateDestSuggestion(newLineAllocs, undefined);
    setTimeout(syncTotal, 0);
  };

  const resetDestState = () => {
    setTransfereeSummary(null);
    setDestMode('new');
    setDestSuggestion(null);
    form.setFieldValue('to_allocation_id', undefined);
  };

  const updateDestSuggestion = (currentLineAllocs, tSummary) => {
    const summary = tSummary ?? transfereeSummary;
    if (!summary?.allocations?.length) { setDestSuggestion(null); return; }
    const usedAllocs = Object.values(currentLineAllocs).filter(Boolean);
    const rounds = [...new Set(usedAllocs.map(a => a.round).filter(r => r != null))];
    if (rounds.length === 1) {
      const match = summary.allocations.find(a => a.round === rounds[0]);
      setDestSuggestion(match || null);
    } else {
      setDestSuggestion(null);
    }
  };

  const syncTotal = () => {
    const lines = form.getFieldValue('lines') || [];
    const total = lines.reduce((sum, line) => {
      return sum + (line?.paid_shares_to_transfer || 0) + (line?.unpaid_shares_to_transfer || 0);
    }, 0);
    form.setFieldValue('number_of_shares', total);
    handleCalcFees();
  };

  // Earliest date the Dividend-From-Share-Transfer date may take: the LATEST
  // acquisition date across the currently-selected source allocations. The
  // dividend cutoff can't predate when the shares entered the source
  // allocation (else the dividend breakdown goes negative). Returns a dayjs
  // or null when no allocation with an acquisition date is selected.
  const dividendFromFloor = () => {
    // Floor = latest source date across selected cohorts. For a specific
    // payment that's the payment date; for the all-paid/unpaid pools it's the
    // allocation's acquisition date.
    let floor = null;
    for (const c of Object.values(lineCohorts)) {
      if (!c?.date) continue;
      const d = dayjs(c.date).startOf('day');
      if (!floor || d.isAfter(floor)) floor = d;
    }
    return floor;
  };

  const handleTransferorChange = async (shareholderId) => {
    setTransferorSummary(null);
    setTransferorBlocks([]);
    setTransferorPayments([]);
    setTransferorDetailOpen(false);
    resetLineState();
    setAllocTransfers({});
    form.setFieldValue('lines', [{}]);
    if (!shareholderId) return;
    setSummaryLoading(true);
    try {
      const [summaryRes, blockRes, invRes] = await Promise.all([
        getShareholderInvestmentSummary(shareholderId),
        getShareBlocks({ shareholder_id: shareholderId, page_size: 50 }),
        getInvestments({ shareholder_id: shareholderId, approval_status: 'approved', page_size: 500 }),
      ]);
      setTransferorSummary(summaryRes.data);
      setTransferorBlocks((blockRes.data.data || []).filter(b => !b.is_released));
      // Positive, active, allocation-linked payments become per-cohort sources.
      setTransferorPayments((invRes.data.data || []).filter(
        i => (i.number_of_shares || 0) > 0 && i.status === 'active' && i.allocation_id
      ));
    } catch { /* ignore */ }
    setSummaryLoading(false);
  };

  const handleTransfereeChange = async (shareholderId) => {
    resetDestState();
    if (!shareholderId) return;
    setTransfereeSummaryLoading(true);
    try {
      const res = await getShareholderInvestmentSummary(shareholderId);
      setTransfereeSummary(res.data);
      updateDestSuggestion(lineAllocs, res.data);
    } catch { /* ignore */ }
    setTransfereeSummaryLoading(false);
  };

  const handleLineModeChange = (fkey, mode, alloc, fieldName) => {
    setLineModes(prev => ({ ...prev, [fkey]: mode }));
    const paid = alloc?.paid_shares || 0;
    const unpaid = Math.max(0, (alloc?.allocated_shares || 0) - paid);
    // Subtract blocked so "Full" only transfers what's actually available.
    // totalFree caps via direct block_shares sum (handles legacy blocks with no paid/unpaid split).
    const totalFree = Math.max(0, (alloc?.allocated_shares || 0) - (alloc?.blocked_shares || 0));
    const availPaid = Math.max(0, Math.min(paid - (alloc?.paid_blocked_shares || 0), totalFree));
    const availUnpaid = Math.max(0, Math.min(unpaid - (alloc?.unpaid_blocked_shares || 0), totalFree));
    if (mode === 'full') {
      form.setFieldValue(['lines', fieldName, 'paid_shares_to_transfer'], availPaid);
      form.setFieldValue(['lines', fieldName, 'unpaid_shares_to_transfer'], availUnpaid);
    } else if (mode === 'paid_only') {
      form.setFieldValue(['lines', fieldName, 'unpaid_shares_to_transfer'], 0);
    } else if (mode === 'unpaid_only') {
      form.setFieldValue(['lines', fieldName, 'paid_shares_to_transfer'], 0);
    }
    syncTotal();
  };

  const loadAllocTransfers = async (allocId, pg = 1) => {
    setAllocTransfers(prev => ({ ...prev, [allocId]: { ...(prev[allocId] || {}), loading: true } }));
    try {
      const res = await getTransfers({ from_allocation_id: allocId, page: pg, page_size: 5 });
      setAllocTransfers(prev => ({
        ...prev,
        [allocId]: { loading: false, data: res.data.data || [], total: res.data.total || 0, page: pg },
      }));
    } catch {
      setAllocTransfers(prev => ({ ...prev, [allocId]: { ...(prev[allocId] || {}), loading: false } }));
    }
  };

  const handleCalcFees = async () => {
    const values = form.getFieldsValue();
    if (values.number_of_shares && values.par_value) {
      try {
        // Pass the source lines so the backend can read each Allocation's
        // cost basis (AllocatedAmount/AllocatedShares) and compute CGT on the
        // actual capital gain, not on the gross transfer value.
        const rawLines = values.lines || [];
        const lines = rawLines
          .filter(l => l?.from_allocation_id)
          .map((line, idx) => {
            const fkey = fieldKeysRef.current[idx];
            const mode = (fkey != null ? lineModes[fkey] : null) || 'paid_only';
            return {
              from_allocation_id:        line.from_allocation_id,
              paid_shares_to_transfer:   mode !== 'unpaid_only' ? (line.paid_shares_to_transfer  || 0) : 0,
              unpaid_shares_to_transfer: mode !== 'paid_only'   ? (line.unpaid_shares_to_transfer || 0) : 0,
            };
          });
        const res = await calculateTransferFees({
          number_of_shares: values.number_of_shares,
          par_value: values.par_value,
          lines,
        });
        setFees(res.data);
      } catch {}
    }
  };

  const handleSubmit = async (values) => {
    const rawLines = values.lines || [];
    const lines = rawLines
      .filter(l => l?.from_allocation_id)
      .map((line, idx) => {
        // find the field key for this index
        const fkey = fieldKeysRef.current[idx];
        const mode = (fkey != null ? lineModes[fkey] : null) || 'paid_only';
        const cohort = fkey != null ? lineCohorts[fkey] : null;
        return {
          from_allocation_id:        line.from_allocation_id,
          // Specific source payment (for the dividend-from floor + cap); only
          // meaningful for a paid payment cohort.
          from_investment_id:        cohort?.kind === 'paid' ? cohort.investmentId : undefined,
          paid_shares_to_transfer:   mode !== 'unpaid_only' ? (line.paid_shares_to_transfer  || 0) : 0,
          unpaid_shares_to_transfer: mode !== 'paid_only'   ? (line.unpaid_shares_to_transfer || 0) : 0,
        };
      });

    // Anchor rule: if the transferor still has unpaid shares after this
    // transfer, they must retain at least 1 paid share. Backend re-enforces
    // this — but failing fast here gives a clearer error in context.
    const allocs = transferorSummary?.allocations || [];
    let currentPaid = 0;
    let currentUnpaid = 0;
    for (const a of allocs) {
      const p = a.paid_shares || 0;
      const u = Math.max(0, (a.allocated_shares || 0) - p);
      currentPaid += p;
      currentUnpaid += u;
    }
    const paidToTransfer = lines.reduce((s, l) => s + (l.paid_shares_to_transfer || 0), 0);
    const unpaidToTransfer = lines.reduce((s, l) => s + (l.unpaid_shares_to_transfer || 0), 0);
    const paidAfter = currentPaid - paidToTransfer;
    const unpaidAfter = currentUnpaid - unpaidToTransfer;
    if (unpaidAfter > 0 && paidAfter < 1) {
      const maxPaid = Math.max(0, currentPaid - 1);
      message.error(
        `Transfer would leave the shareholder with 0 paid + ${unpaidAfter.toLocaleString()} unpaid shares. ` +
        `At least 1 paid share must remain while any unpaid shares exist. ` +
        `Reduce paid transfer to at most ${maxPaid.toLocaleString()}, or also transfer the remaining ${unpaidAfter.toLocaleString()} unpaid shares.`,
        8,
      );
      return;
    }

    const payload = {
      transferor_id:        values.transferor_id,
      transferee_id:        values.transferee_id,
      transfer_type:        values.transfer_type,
      par_value:            values.par_value,
      number_of_shares:     values.number_of_shares,
      is_full_transfer:     values.is_full_transfer || false,
      agreed_dividend_date: values.agreed_dividend_date ? values.agreed_dividend_date.toISOString() : undefined,
      reason:               values.reason,
      to_allocation_id:     destMode === 'existing' ? (values.to_allocation_id || null) : null,
      lines:                lines,
    };

    try {
      await createTransfer(payload);
      message.success('Transfer created, pending approval');
      setModalOpen(false);
      form.resetFields();
      setFees(null);
      setTransferorSummary(null);
      setTransferorBlocks([]);
      resetLineState();
      resetDestState();
      setAllocTransfers({});
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  // Nested transfer history columns shown inside expanded allocation rows
  const allocTransferHistoryCols = [
    { title: 'Batch No', dataIndex: 'batch_no', width: 140 },
    { title: 'To Sh. ID', key: 'toShid', width: 80, render: (_, r) => r.transferee_id ?? r.transferee?.id ?? '-' },
    { title: 'Transferee', key: 'to', render: (_, r) => r.transferee ? `${r.transferee.first_name} ${r.transferee.last_name}` : '-' },
    { title: 'Shares', dataIndex: 'number_of_shares', width: 80 },
    { title: 'Amount', dataIndex: 'transfer_amount', render: v => formatCurrency(v) },
    { title: 'Date', dataIndex: 'transfer_date', width: 105, render: d => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
    { title: 'Div. Cutoff', dataIndex: 'agreed_dividend_date', width: 105, render: d => d ? dayjs(d).format('YYYY-MM-DD') : <Text type="secondary">—</Text> },
    {
      title: 'Status', dataIndex: 'approval_status', width: 85,
      render: (s, r) => {
        const tag = <Tag color={s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange'}>{s}</Tag>;
        return s === 'rejected' && r.rejection_reason
          ? <Tooltip title={r.rejection_reason} placement="left">{tag}</Tooltip>
          : tag;
      },
    },
  ];

  // Allocations table shown inside the transferor summary card
  const allocColumns = [
    { title: 'Alloc No', dataIndex: 'allocation_no', width: 110 },
    { title: 'Rnd', dataIndex: 'round', width: 45 },
    {
      title: 'Owned (Paid)', key: 'owned',
      render: (_, r) => (
        <div>
          <Text strong style={{ color: '#52c41a' }}>{(r.paid_shares || 0).toLocaleString()} shares</Text>
          <div style={{ color: '#888', fontSize: 11 }}>{formatCurrency(r.paid_amount)}</div>
        </div>
      ),
    },
    {
      title: 'Allocated', key: 'alloc',
      render: (_, r) => (
        <div>
          <span>{(r.allocated_shares || 0).toLocaleString()} shares</span>
          <div style={{ color: '#888', fontSize: 11 }}>{formatCurrency(r.allocated_amount)}</div>
        </div>
      ),
    },
    {
      title: 'Outstanding', key: 'outstanding',
      render: (_, r) => (
        <div style={{ color: r.remaining_amount > 0 ? '#f5222d' : '#52c41a' }}>
          {formatCurrency(r.remaining_amount)}
        </div>
      ),
    },
    {
      title: 'Blocked', key: 'blocked', width: 120,
      render: (_, r) => {
        const pb = r.paid_blocked_shares || 0;
        const ub = r.unpaid_blocked_shares || 0;
        const tb = r.blocked_shares || 0;
        if (tb === 0) return <Text type="secondary">—</Text>;
        // Legacy blocks: paid/unpaid split not recorded — show total only
        if (pb === 0 && ub === 0 && tb > 0) {
          return <Tag color="red" style={{ fontSize: 11, margin: 0 }}>{tb} blocked</Tag>;
        }
        return (
          <Space size={2} direction="vertical" style={{ lineHeight: 1.2 }}>
            {pb > 0 && <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>{pb} paid blocked</Tag>}
            {ub > 0 && <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>{ub} unpaid blocked</Tag>}
          </Space>
        );
      },
    },
    {
      title: 'Payment Status', dataIndex: 'payment_status', width: 130,
      render: s => <Tag icon={statusIcons[s]} color={statusColors[s]}>{statusLabels[s] || s}</Tag>,
    },
    {
      title: 'Type', dataIndex: 'subscription_type', width: 90,
      render: v => v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">-</Text>,
    },
  ];

  // Active share blocks table
  const blockColumns = [
    {
      title: 'Type', dataIndex: 'block_type', width: 110,
      render: t => <Tag color={blockTypeColors[t] || 'default'}>{(t || '').replace(/_/g, ' ')}</Tag>,
    },
    {
      title: 'Blocked Shares', key: 'block_shares', width: 150,
      render: (_, r) => r.shares_type === 'both' ? (
        <Space size={2}>
          <Tag color="blue" style={{ fontSize: 11 }}>{r.paid_shares_to_block || 0} paid</Tag>
          <Tag color="orange" style={{ fontSize: 11 }}>{r.unpaid_shares_to_block || 0} unpaid</Tag>
        </Space>
      ) : (
        <Text strong style={{ color: '#ff4d4f' }}>{(r.block_shares || 0).toLocaleString()} {r.shares_type}</Text>
      ),
    },
    {
      title: 'Allocation', key: 'allocation', width: 160,
      render: (_, r) => r.allocation
        ? <Tag color="purple">{r.allocation.allocation_no} · Rnd {r.allocation.round}</Tag>
        : <Text type="secondary">Not linked</Text>,
    },
    { title: 'Reason', dataIndex: 'reason', ellipsis: true },
    {
      title: 'Block Date', dataIndex: 'block_date', width: 100,
      render: d => d ? dayjs(d).format('YYYY-MM-DD') : '—',
    },
    {
      title: 'Status', dataIndex: 'approval_status', width: 85,
      render: (s, r) => {
        // Previously hardcoded 'red' for approved which was a bug — using
        // standard color scheme (green/red/orange) matching the other tables.
        const tag = <Tag color={s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange'}>{s}</Tag>;
        return s === 'rejected' && r.rejection_reason
          ? <Tooltip title={r.rejection_reason} placement="left">{tag}</Tooltip>
          : tag;
      },
    },
  ];

  const columns = [
    { title: 'Batch No', dataIndex: 'batch_no', width: 150 },
    { title: 'From Sh. ID', key: 'fromShid', width: 90, render: (_, r) => r.transferor_id ?? r.transferor?.id ?? '-' },
    { title: 'Transferor', key: 'from', render: (_, r) => r.transferor ? `${r.transferor.first_name} ${r.transferor.last_name}` : '-' },
    { title: 'To Sh. ID', key: 'toShid', width: 80, render: (_, r) => r.transferee_id ?? r.transferee?.id ?? '-' },
    { title: 'Transferee', key: 'to', render: (_, r) => r.transferee ? `${r.transferee.first_name} ${r.transferee.last_name}` : '-' },
    { title: 'Type', dataIndex: 'transfer_type', render: t => <Tag>{t}</Tag> },
    { title: 'Shares', dataIndex: 'number_of_shares', width: 80 },
    { title: 'Amount', dataIndex: 'transfer_amount', render: v => formatCurrency(v) },
    { title: 'Total Fees', dataIndex: 'total_fees', render: v => formatCurrency(v) },
    { title: 'Date', dataIndex: 'transfer_date', width: 105, render: d => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
    {
      title: 'Status', dataIndex: 'approval_status', width: 90,
      render: (s, r) => {
        const tag = <Tag color={s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange'}>{s}</Tag>;
        return s === 'rejected' && r.rejection_reason
          ? <Tooltip title={r.rejection_reason} placement="left">{tag}</Tooltip>
          : tag;
      },
    },
  ];

  // Computed values for summary card
  const totalBlocked = transferorBlocks.reduce((s, b) => s + (b.block_shares || 0), 0);
  const totalOwned = transferorSummary?.total_shares_paid || 0;
  const availableForTransfer = Math.max(0, totalOwned - totalBlocked);

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Transfers</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          form.resetFields();
          form.setFieldValue('par_value', parValue);
          form.setFieldValue('lines', [{}]);
          setFees(null);
          setTransferorSummary(null);
          setTransferorBlocks([]);
          resetLineState();
          resetDestState();
          setShareholders([]);
          setModalOpen(true);
        }}>
          New Transfer
        </Button>
      </Row>

      {/* Search & Filter bar */}
      <Row gutter={16} style={{ marginBottom: 16 }} align="middle">
        <Col span={9}>
          <Input.Search
            placeholder="Search by transferor, transferee name, account or batch no..."
            prefix={<SearchOutlined />}
            allowClear
            disabled={!!activeFilters}
            onSearch={(v) => { setSearch(v); setPage(1); }}
          />
        </Col>
        <Col span={4}>
          <Select
            placeholder="Transfer type"
            allowClear
            style={{ width: '100%' }}
            options={transferTypes}
            disabled={!!activeFilters}
            onChange={(v) => { setTypeFilter(v || ''); setPage(1); }}
          />
        </Col>
        <Col span={4}>
          <Select
            placeholder="Approval status"
            allowClear
            style={{ width: '100%' }}
            disabled={!!activeFilters}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
            ]}
            onChange={(v) => { setStatusFilter(v || ''); setPage(1); }}
          />
        </Col>
        <Col span={5}>
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
        fields={TRF_FIELDS}
        open={advancedOpen}
        onSearch={runAdvancedSearch}
        onReset={resetAdvancedSearch}
      />

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage, showTotal: t => `Total ${t}` }}
        scroll={{ x: 1100 }} />

      {/* Create Modal */}
      <Modal title="New Transfer" open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setTransferorSummary(null);
          setTransferorBlocks([]);
          resetLineState();
          resetDestState();
          setAllocTransfers({});
        }}
        footer={null} width={960}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>

          {/* Transferor / Transferee selectors */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="transferor_id" label="Transferor (From)" rules={[{ required: true }]}>
                <Select showSearch allowClear filterOption={false}
                  onSearch={handleShareholderSearch}
                  onDropdownVisibleChange={handleDropdownOpen}
                  onChange={handleTransferorChange}
                  onClear={() => loadDefaultShareholders()}
                  options={shareholders.filter(o => o.value !== watchedTransferee)}
                  notFoundContent="Type 2+ chars of a name, account no, or ID"
                  placeholder="Search by name, account no, or ID…" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="transferee_id" label="Transferee (To)" rules={[{ required: true }]}>
                <Select showSearch allowClear filterOption={false}
                  onSearch={handleShareholderSearch}
                  onDropdownVisibleChange={handleDropdownOpen}
                  onChange={handleTransfereeChange}
                  onClear={() => loadDefaultShareholders()}
                  options={shareholders.filter(o => o.value !== watchedTransferor)}
                  notFoundContent="Type 2+ chars of a name, account no, or ID"
                  placeholder="Search by name, account no, or ID…" />
              </Form.Item>
            </Col>
          </Row>

          {/* Transferor summary card */}
          {summaryLoading && <Spin style={{ display: 'block', margin: '8px auto 16px' }} />}
          {transferorSummary && !summaryLoading && (
            <Card size="small"
              style={{ marginBottom: 16, background: '#fafafa', border: '1px solid #d32f2f' }}
              title={
                <Space>
                  <InfoCircleOutlined style={{ color: '#d32f2f' }} />
                  <Text strong>Transferor Share Summary</Text>
                  <Tag icon={statusIcons[transferorSummary.payment_status]} color={statusColors[transferorSummary.payment_status]}>
                    {statusLabels[transferorSummary.payment_status]}
                  </Tag>
                </Space>
              }
            >
              {/* Key metrics */}
              <Row gutter={12} style={{ marginBottom: 8 }}>
                <Col span={5}>
                  <Text type="secondary" style={{ fontSize: 11 }}>OWNED SHARES</Text>
                  <div><Text strong>{totalOwned.toLocaleString()}</Text></div>
                  <Text type="secondary" style={{ fontSize: 11 }}>{formatCurrency(transferorSummary.total_paid)}</Text>
                </Col>
                <Col span={5}>
                  <Text type="secondary" style={{ fontSize: 11 }}>ALLOCATED</Text>
                  <div><Text strong>{(transferorSummary.total_allocated_shares || 0).toLocaleString()}</Text></div>
                  <Text type="secondary" style={{ fontSize: 11 }}>{formatCurrency(transferorSummary.total_allocated_amount)}</Text>
                </Col>
                <Col span={5}>
                  <Text type="secondary" style={{ fontSize: 11 }}>OUTSTANDING</Text>
                  <div>
                    <Text strong style={{ color: (transferorSummary.outstanding_balance || 0) > 0 ? '#f5222d' : '#52c41a' }}>
                      {formatCurrency(transferorSummary.outstanding_balance)}
                    </Text>
                  </div>
                </Col>
                <Col span={5}>
                  <Text type="secondary" style={{ fontSize: 11 }}>BLOCKED</Text>
                  <div>
                    <Text strong style={{ color: totalBlocked > 0 ? '#ff4d4f' : '#888' }}>
                      {totalBlocked.toLocaleString()} shares
                    </Text>
                  </div>
                </Col>
                <Col span={4}>
                  <Text type="secondary" style={{ fontSize: 11 }}>AVAILABLE</Text>
                  <div>
                    <Text strong style={{ color: availableForTransfer > 0 ? '#52c41a' : '#ff4d4f', fontSize: 15 }}>
                      {availableForTransfer.toLocaleString()}
                    </Text>
                  </div>
                </Col>
              </Row>

              {/* Allocations & Blocks — behind a detail button (a shareholder may have many allocations) */}
              {(transferorSummary.allocations?.length > 0 || transferorBlocks.length > 0) && (
                <>
                  <Divider style={{ margin: '8px 0' }} />
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0 }}
                    onClick={() => setTransferorDetailOpen(true)}
                  >
                    View allocations &amp; payment status
                    {transferorSummary.allocations?.length > 0 && ` (${transferorSummary.allocations.length})`}
                    {transferorBlocks.length > 0 && ` · ${transferorBlocks.length} block${transferorBlocks.length > 1 ? 's' : ''}`}
                  </Button>
                </>
              )}
            </Card>
          )}

          {/* Source Allocations — Form.List */}
          {transferorSummary && (
            <>
              <Divider style={{ margin: '8px 0' }} />
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Source Payments</Text>
              <Form.List name="lines" initialValue={[{}]}>
                {(fields, { add, remove }) => {
                  // Keep ref in sync with current field keys for submit mapping
                  fieldKeysRef.current = fields.map(f => f.key);
                  const allCohorts = cohortsForTransferor();
                  return (
                    <>
                      {fields.map(field => {
                        const cohort = lineCohorts[field.key];
                        // One source cohort per allocation per transfer — mirrors
                        // the old one-line-per-allocation rule and keeps the
                        // backend's allocation-level availability accounting valid.
                        const usedAllocIds = new Set(
                          Object.entries(lineCohorts)
                            .filter(([k]) => k !== String(field.key))
                            .map(([, c]) => c?.allocationId)
                            .filter(Boolean)
                        );
                        const cohortOptions = allCohorts
                          .filter(c => c.allocationId === cohort?.allocationId || !usedAllocIds.has(c.allocationId))
                          .map(c => ({ value: c.key, label: c.label }));

                        return (
                          <Card key={field.key} size="small"
                            style={{ marginBottom: 8, borderColor: '#722ed1' }}
                            extra={fields.length > 1 && (
                              <Button type="text" danger size="small"
                                onClick={() => {
                                  remove(field.name);
                                  setLineAllocs(prev => { const n = { ...prev }; delete n[field.key]; return n; });
                                  setLineModes(prev => { const n = { ...prev }; delete n[field.key]; return n; });
                                  setLineCohorts(prev => { const n = { ...prev }; delete n[field.key]; return n; });
                                  setTimeout(syncTotal, 0);
                                }}>
                                Remove
                              </Button>
                            )}>

                            {/* Source payment / cohort selector — the allocation
                                is derived from the chosen payment. */}
                            <Form.Item name={[field.name, 'cohort_key']}
                              label="Source payment"
                              tooltip="Pick the exact payment to sell from. Each payment has its own date, and the Dividend-From date can't be earlier than it. The allocation is derived from the payment."
                              rules={[{ required: true, message: 'Select a source payment' }]}
                              style={{ marginBottom: 8 }}>
                              <Select
                                placeholder="Select a payment / cohort to transfer from…"
                                onChange={(ck) => onCohortChange(field, ck, allCohorts)}
                                options={cohortOptions}
                                notFoundContent="No transferable shares for this shareholder"
                              />
                            </Form.Item>

                            {/* Selected cohort detail + single shares input */}
                            {cohort && (
                              <>
                                <Row gutter={12} style={{ marginBottom: 8 }}>
                                  <Col span={8}>
                                    <Text type="secondary" style={{ fontSize: 11 }}>ALLOCATION</Text>
                                    <div><Tag color="purple">{cohort.allocationNo} · Rnd {cohort.round}</Tag></div>
                                  </Col>
                                  <Col span={8}>
                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                      {cohort.kind === 'unpaid' ? 'UNPAID (SUBSCRIBED)' : 'PAID'} AVAILABLE
                                    </Text>
                                    <div><Text strong style={{ color: cohort.kind === 'unpaid' ? '#faad14' : '#52c41a' }}>{cohort.shares.toLocaleString()} shares</Text></div>
                                  </Col>
                                  <Col span={8}>
                                    <Text type="secondary" style={{ fontSize: 11 }}>DIVIDEND-FROM FLOOR</Text>
                                    <div><Text strong>{cohort.date ? dayjs(cohort.date).format('YYYY-MM-DD') : '—'}</Text></div>
                                  </Col>
                                </Row>

                                <Form.Item
                                  name={[field.name, cohort.kind === 'unpaid' ? 'unpaid_shares_to_transfer' : 'paid_shares_to_transfer']}
                                  label={`Shares to transfer (max ${cohort.shares.toLocaleString()})`}
                                  validateFirst
                                  rules={[
                                    { required: true, message: 'Required' },
                                    {
                                      validator: (_, v) => {
                                        if (v == null || v === '') return Promise.resolve();
                                        if (v < 1) return Promise.reject(new Error('Must be at least 1'));
                                        if (v > cohort.shares) return Promise.reject(new Error(`Cannot exceed available ${cohort.shares.toLocaleString()} shares. Reduce the amount.`));
                                        return Promise.resolve();
                                      },
                                    },
                                  ]}
                                  style={{ marginBottom: 8 }}>
                                  {/* No max prop: keep an over-limit value so the validator shows a
                                      hard error rather than AntD silently clamping it on blur. */}
                                  <InputNumber style={{ width: '100%' }} min={1} precision={0} onChange={syncTotal} />
                                </Form.Item>
                              </>
                            )}
                          </Card>
                        );
                      })}

                      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                        <Col>
                          <Button type="dashed"
                            disabled={fields.length >= (transferorSummary?.allocations?.length || 0)}
                            onClick={() => add({})}>
                            + Add another source
                          </Button>
                        </Col>
                        <Col>
                          <Text type="secondary">Total across all sources: </Text>
                          <Text strong style={{ color: '#d32f2f', fontSize: 14 }}>
                            {(form.getFieldValue('number_of_shares') || 0).toLocaleString()} shares
                          </Text>
                        </Col>
                      </Row>
                    </>
                  );
                }}
              </Form.List>

              {/* Destination Allocation card */}
              <Card size="small" title="Transferee Destination Allocation"
                style={{ marginBottom: 16, borderColor: '#13c2c2' }}>
                {transfereeSummaryLoading && <Spin size="small" />}

                {/* Hint when transferee not yet selected */}
                {!transfereeSummary && !transfereeSummaryLoading && (
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                    Select a transferee above — "Add to existing allocation" will become available if the transferee has existing allocations.
                  </Text>
                )}

                {/* Smart suggestion banner */}
                {destSuggestion && destMode === 'new' && (
                  <div style={{ background: '#e6fffb', border: '1px solid #87e8de', borderRadius: 4, padding: '8px 12px', marginBottom: 12 }}>
                    <Text>
                      <strong>Suggested:</strong> Merge into <strong>{destSuggestion.allocation_no}</strong>
                      {' '}(Round {destSuggestion.round} · {(destSuggestion.allocated_shares || 0).toLocaleString()} allocated
                      · {(destSuggestion.paid_shares || 0).toLocaleString()} paid)
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      <Button size="small" type="primary" ghost
                        onClick={() => {
                          setDestMode('existing');
                          form.setFieldValue('to_allocation_id', destSuggestion.id);
                        }}>
                        Use This
                      </Button>
                      <Button size="small" style={{ marginLeft: 8 }}
                        onClick={() => setDestSuggestion(null)}>
                        Create New Instead
                      </Button>
                    </div>
                  </div>
                )}

                {/* Mixed-round note */}
                {!destSuggestion && Object.values(lineAllocs).filter(Boolean).length > 0 &&
                  new Set(Object.values(lineAllocs).filter(Boolean).map(a => a.round)).size > 1 && (
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 11 }}>
                    Shares from multiple rounds will be combined into a single destination allocation.
                  </Text>
                )}

                <Form.Item label="Destination" style={{ marginBottom: 8 }}>
                  <Radio.Group value={destMode} onChange={e => {
                    setDestMode(e.target.value);
                    form.setFieldValue('to_allocation_id', undefined);
                  }}>
                    <Radio value="new">Create new allocation for transferee</Radio>
                    <Radio value="existing" disabled={!transfereeSummary?.allocations?.length}>
                      Add to existing allocation
                      {transfereeSummary && !transfereeSummary?.allocations?.length && (
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>(transferee has no existing allocations)</Text>
                      )}
                    </Radio>
                  </Radio.Group>
                </Form.Item>

                {destMode === 'existing' && transfereeSummary?.allocations?.length > 0 && (
                  <Form.Item name="to_allocation_id" label="Select Existing Allocation"
                    rules={[{ required: true, message: 'Select a destination allocation' }]}>
                    <Select
                      placeholder="Select allocation..."
                      options={transfereeSummary.allocations.map(a => ({
                        value: a.id,
                        label: `${a.allocation_no} | Rnd ${a.round} | ${(a.allocated_shares || 0).toLocaleString()} allocated · ${(a.paid_shares || 0).toLocaleString()} paid · ${formatCurrency(a.remaining_amount)} outstanding`,
                      }))}
                    />
                  </Form.Item>
                )}
                {destMode === 'new' && !destSuggestion && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    A new allocation record will be created upon approval.
                  </Text>
                )}
              </Card>
            </>
          )}

          {/* Transfer details */}
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="transfer_type" label="Transfer Type" rules={[{ required: true }]}>
                <Select options={transferTypes} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="par_value"
                label="Selling Price / Share"
                tooltip={`Defaults to the company par value (ETB ${parValue}). For Sale transfers, enter the agreed price per share — any amount above the cost basis becomes capital gain.`}
                extra={`Company par: ETB ${parValue}`}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={1}
                  onChange={() => handleCalcFees()}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="number_of_shares" label="Number of Shares"
                extra={transferorSummary ? `Available: ${availableForTransfer.toLocaleString()} shares` + (totalBlocked > 0 ? ` (${totalBlocked.toLocaleString()} blocked)` : '') : undefined}>
                <InputNumber style={{ width: '100%' }} disabled precision={0} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="is_full_transfer" label="Full Transfer" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="agreed_dividend_date"
                label="Dividend From Share Transfer Date"
                tooltip="This date counts as the Transferee's first dividend day; the Transferor is credited up to the day before. Leave blank to use the transfer approval date. Cannot be earlier than the source allocation's acquisition date."
                extra={(() => {
                  const floor = dividendFromFloor();
                  return floor
                    ? <Text type="secondary" style={{ fontSize: 11 }}>Must be on or after {floor.format('YYYY-MM-DD')} (source allocation acquired)</Text>
                    : null;
                })()}
                rules={[{
                  validator: (_, value) => {
                    if (!value) return Promise.resolve();
                    const floor = dividendFromFloor();
                    if (floor && value.startOf('day').isBefore(floor)) {
                      return Promise.reject(new Error(`Cannot be earlier than ${floor.format('YYYY-MM-DD')} — the source allocation acquired its shares then.`));
                    }
                    return Promise.resolve();
                  },
                }]}
              >
                <DatePicker
                  style={{ width: '100%' }}
                  format="YYYY-MM-DD"
                  disabledDate={(current) => {
                    const floor = dividendFromFloor();
                    return floor && current && current.startOf('day').isBefore(floor);
                  }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="reason" label="Reason">
            <Input.TextArea rows={2} />
          </Form.Item>

          {/* Fee calculation result */}
          {fees && (
            <Card size="small" title="Calculated Transfer Fees" style={{ marginBottom: 16, borderColor: '#faad14' }}>
              {/* Capital-gain math, shown above the fee grid for transparency */}
              <div style={{ background: '#fafafa', padding: '8px 10px', borderRadius: 4, marginBottom: 12, fontSize: 12 }}>
                <Text type="secondary">CGT = {fees.capital_gain_tax_rate}% × (selling − cost basis) × shares.</Text>
                <div style={{ marginTop: 4, fontFamily: 'monospace' }}>
                  Selling/share: <Text strong>{formatCurrency(fees.selling_price_per_share)}</Text> {' − '}
                  Cost basis/share: <Text strong>{formatCurrency(fees.cost_basis_per_share)}</Text> {' = '}
                  Gain/share: <Text strong style={{ color: fees.gain_per_share > 0 ? '#cf1322' : '#3f8600' }}>
                    {formatCurrency(fees.gain_per_share)}
                  </Text>
                  {' · '}
                  Capital gain: <Text strong>{formatCurrency(fees.capital_gain)}</Text>
                </div>
              </div>

              <Row gutter={16}>
                <Col span={8}>
                  <Text type="secondary" style={{ fontSize: 11 }}>TRANSFER VALUE</Text>
                  <div><Text strong>{formatCurrency(fees.transfer_value)}</Text></div>
                </Col>
                <Col span={8}>
                  <Text type="secondary" style={{ fontSize: 11 }}>CAPITAL GAIN TAX ({fees.capital_gain_tax_rate}%)</Text>
                  <div><Text strong>{formatCurrency(fees.capital_gain_tax)}</Text></div>
                </Col>
                <Col span={8}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    SERVICE FEE ({fees.service_fee_rate}% of par value)
                    {fees.service_fee_floor_applied && <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>min applied</Tag>}
                    {fees.service_fee_cap_applied && <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>capped</Tag>}
                  </Text>
                  <div><Text strong>{formatCurrency(fees.service_fee)}</Text></div>
                  <Text type="secondary" style={{ fontSize: 10 }}>
                    on {formatNumber(form.getFieldValue('number_of_shares') || 0)} × company par
                  </Text>
                </Col>
                <Col span={8} style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    STAMP DUTY {fees.stamp_duty_type === 'fixed' ? '(fixed)' : `(${fees.stamp_duty_rate}%)`}
                  </Text>
                  <div><Text strong>{formatCurrency(fees.stamp_duty)}</Text></div>
                </Col>
                <Col span={8} style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>VAT ({fees.vat_rate}%)</Text>
                  <div><Text strong>{formatCurrency(fees.vat)}</Text></div>
                </Col>
                <Col span={8} style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>TOTAL FEES</Text>
                  <div><Text strong style={{ color: '#f5222d', fontSize: 15 }}>{formatCurrency(fees.total_fees)}</Text></div>
                </Col>
              </Row>
            </Card>
          )}

          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => {
                setModalOpen(false);
                setTransferorSummary(null);
                setTransferorBlocks([]);
                setTransferorDetailOpen(false);
                resetLineState();
                resetDestState();
                setAllocTransfers({});
              }}>
                Cancel
              </Button>
              <Button type="primary" htmlType="submit">Create Transfer</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Transferor allocations & blocks — detail modal */}
      <Modal
        title={transferorSummary ? `${transferorSummary.shareholder?.first_name || ''} ${transferorSummary.shareholder?.last_name || ''} — Allocations & Payment Status` : 'Allocations & Payment Status'}
        open={transferorDetailOpen}
        onCancel={() => setTransferorDetailOpen(false)}
        footer={null}
        width={900}
      >
        {transferorSummary?.allocations?.length > 0 && (
          <>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
              ALLOCATIONS &amp; PAYMENT STATUS
            </Text>
            <Table
              dataSource={transferorSummary.allocations}
              columns={allocColumns}
              rowKey="id"
              size="small"
              pagination={false}
              style={{ fontSize: 12 }}
              expandable={{
                expandedRowRender: (alloc) => {
                  const state = allocTransfers[alloc.id] || {};
                  return (
                    <div style={{ padding: '8px 0' }}>
                      <Table
                        dataSource={state.data || []}
                        columns={allocTransferHistoryCols}
                        loading={state.loading}
                        rowKey="id"
                        size="small"
                        pagination={{
                          size: 'small',
                          current: state.page || 1,
                          total: state.total || 0,
                          pageSize: 5,
                          onChange: (p) => loadAllocTransfers(alloc.id, p),
                          showTotal: t => `${t} transfers`,
                        }}
                        locale={{ emptyText: 'No transfers from this allocation' }}
                      />
                    </div>
                  );
                },
                onExpand: (expanded, alloc) => {
                  if (expanded && !allocTransfers[alloc.id]) {
                    loadAllocTransfers(alloc.id);
                  }
                },
              }}
            />
          </>
        )}

        {transferorBlocks.length > 0 && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
              ACTIVE SHARE BLOCKS
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                — blocks without a linked allocation show "Not linked"
              </Text>
            </Text>
            <Table
              dataSource={transferorBlocks}
              columns={blockColumns}
              rowKey="id"
              size="small"
              pagination={false}
              style={{ fontSize: 12 }}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
