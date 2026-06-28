import { useState, useEffect, useRef } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, InputNumber, Space, Tag, Divider,
  message, Typography, Row, Col, Popconfirm, Card, Statistic, Descriptions, Alert,
  Tooltip, Checkbox, Radio, Switch,
} from 'antd';
import {
  DollarOutlined, InfoCircleOutlined, RiseOutlined, HistoryOutlined,
  CalculatorOutlined, FileExcelOutlined, PrinterOutlined, FilterOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  getDividends, collectDividend, blockDividend, releaseDividend,
  transferDividend, reinvestDividend, getDividendBreakdown, getDividendHistory,
  getBankCapital, searchShareholders, getShareholderInvestmentSummary,
  searchDividendsAdvanced,
} from '../services/api';
import { formatCurrency, formatNumber, paymentMethods } from '../utils/format';
import AdvancedSearchPanel from '../components/AdvancedSearchPanel';

// Field whitelist for the dividend advanced-search panel. Mirrors the
// backend's dividendFieldType map exactly so every field is filterable.
const DIVIDEND_FIELDS = [
  { key: 'id',                  label: 'Dividend ID',     type: 'int' },
  { key: 'shareholder_id',      label: 'Shareholder ID',  type: 'int' },
  { key: 'shareholders.first_name',  label: 'First Name',      type: 'string' },
  { key: 'shareholders.middle_name', label: 'Middle Name',     type: 'string' },
  { key: 'shareholders.last_name',   label: 'Last Name',       type: 'string' },
  { key: 'shareholders.account_no',  label: 'Account No',      type: 'string' },
  { key: 'fiscal_year',         label: 'Fiscal Year',     type: 'string' },
  { key: 'weighted_avg_shares', label: 'W.Avg Shares',    type: 'number' },
  { key: 'gross_dividend',      label: 'Gross Dividend',  type: 'number' },
  { key: 'tax_amount',          label: 'Tax Amount',      type: 'number' },
  { key: 'net_dividend',        label: 'Net Dividend',    type: 'number' },
  { key: 'collected_amount',    label: 'Collected',       type: 'number' },
  { key: 'uncollected_amount',  label: 'Uncollected',     type: 'number' },
  { key: 'reinvested_amount',   label: 'Reinvested',      type: 'number' },
  { key: 'payment_method',      label: 'Payment Method',  type: 'enum', options: paymentMethods },
  { key: 'is_blocked',          label: 'Blocked',         type: 'bool' },
  { key: 'is_transferred',      label: 'Transferred',     type: 'bool' },
  { key: 'is_transfer_pending', label: 'Transfer Pending', type: 'bool' },
  { key: 'transfer_to',         label: 'Transferred To',  type: 'string' },
  { key: 'transfer_reason',     label: 'Transfer Reason', type: 'enum', options: [{value:'inheritance',label:'Inheritance'},{value:'legal_order',label:'Legal Order'}] },
  { key: 'status',              label: 'Status',          type: 'enum', options: [{value:'pending',label:'Pending'},{value:'partial',label:'Partial'},{value:'collected',label:'Collected'},{value:'transferred',label:'Transferred'},{value:'settled',label:'Settled'}] },
  { key: 'approval_status',     label: 'Approval Status', type: 'enum', options: [{value:'pending',label:'Pending'},{value:'approved',label:'Approved'},{value:'rejected',label:'Rejected'}] },
  { key: 'collection_date',     label: 'Collection Date', type: 'date' },
  { key: 'created_at',          label: 'Created At',      type: 'date' },
];

// Excel export schema. Each column is a key, user-facing label, group (for
// UI sectioning), getter (cell value as PRIMITIVE — no JSX), and a
// defaultSelected flag that drives the initial checkbox state.
const EXPORT_COLUMNS = [
  { key: 'id',                   group: 'Identity', label: 'ID',                  getter: r => r.id,                                                                                                    defaultSelected: true  },
  { key: 'shareholder_id',       group: 'Identity', label: 'Shareholder ID',      getter: r => r.shareholder_id ?? r.shareholder?.id ?? '',                                                             defaultSelected: true  },
  { key: 'shareholder_name',     group: 'Identity', label: 'Shareholder Name',    getter: r => r.shareholder ? `${r.shareholder.first_name || ''} ${r.shareholder.middle_name || ''} ${r.shareholder.last_name || ''}`.replace(/\s+/g, ' ').trim() : '', defaultSelected: true  },
  { key: 'account_no',           group: 'Identity', label: 'Account No',          getter: r => r.shareholder?.account_no ?? '',                                                                         defaultSelected: true  },
  { key: 'fiscal_year',          group: 'Identity', label: 'Fiscal Year',         getter: r => r.fiscal_year,                                                                                           defaultSelected: true  },
  { key: 'weighted_avg_shares',  group: 'Shares & Amounts', label: 'W.Avg Shares (stored)', getter: r => r.weighted_avg_shares,                                                                          defaultSelected: true  },
  { key: 'live_weighted_shares', group: 'Shares & Amounts', label: 'W.Avg Shares (live)',   getter: r => r.live_weighted_shares,                                                                         defaultSelected: false },
  { key: 'gross_dividend',       group: 'Shares & Amounts', label: 'Gross (stored)',        getter: r => r.gross_dividend,                                                                               defaultSelected: true  },
  { key: 'live_gross_dividend',  group: 'Shares & Amounts', label: 'Gross (live)',          getter: r => r.live_gross_dividend,                                                                          defaultSelected: false },
  { key: 'reinvested_amount',    group: 'Shares & Amounts', label: 'Reinvested',            getter: r => r.reinvested_amount || 0,                                                                       defaultSelected: true  },
  { key: 'tax_amount',           group: 'Shares & Amounts', label: 'Tax (stored)',          getter: r => r.tax_amount,                                                                                   defaultSelected: true  },
  { key: 'live_tax_amount',      group: 'Shares & Amounts', label: 'Tax (live)',            getter: r => r.live_tax_amount,                                                                              defaultSelected: false },
  { key: 'net_dividend',         group: 'Shares & Amounts', label: 'Net (stored)',          getter: r => r.net_dividend,                                                                                 defaultSelected: true  },
  { key: 'live_net_dividend',    group: 'Shares & Amounts', label: 'Net (live)',            getter: r => r.live_net_dividend,                                                                            defaultSelected: false },
  { key: 'collected_amount',     group: 'Collection State', label: 'Collected',             getter: r => r.collected_amount,                                                                             defaultSelected: true  },
  { key: 'uncollected_amount',   group: 'Collection State', label: 'Uncollected',           getter: r => r.uncollected_amount,                                                                           defaultSelected: true  },
  { key: 'status',               group: 'Collection State', label: 'Status',                getter: r => r.status,                                                                                       defaultSelected: true  },
  { key: 'is_blocked',           group: 'Collection State', label: 'Blocked?',              getter: r => r.is_blocked ? 'Yes' : 'No',                                                                    defaultSelected: false },
  { key: 'is_transferred',       group: 'Collection State', label: 'Transferred?',          getter: r => r.is_transferred ? 'Yes' : 'No',                                                                defaultSelected: false },
  { key: 'transfer_to',          group: 'Collection State', label: 'Transferred To',        getter: r => r.transfer_to ?? '',                                                                            defaultSelected: false },
];

const DEFAULT_EXPORT_COLS = EXPORT_COLUMNS.filter(c => c.defaultSelected).map(c => c.key);
const ALL_EXPORT_COLS = EXPORT_COLUMNS.map(c => c.key);
const EXPORT_GROUPS = [...new Set(EXPORT_COLUMNS.map(c => c.group))];

const { Title, Text } = Typography;

export default function Dividends() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [fiscalYear, setFiscalYear] = useState('');
  const [collectModal, setCollectModal] = useState(null);
  const [transferModal, setTransferModal] = useState(null);
  const [subscribeModal, setSubscribeModal] = useState(null);
  const [parValue, setParValue] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState(null);

  useEffect(() => {
    getBankCapital().then(res => setParValue(res.data?.data?.par_value_per_share || 0)).catch(() => {});
  }, []);
  const [form] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [subscribeForm] = Form.useForm();

  // Expanded row cache: { [dividendId]: { breakdown, history } }
  const [expandedCache, setExpandedCache] = useState({});

  // Per-dividend breakdown view mode: 'audit' (default, additive with negatives)
  // vs 'phased' (positive-only, time-period rows that show the net shares held
  // during each contiguous span between events). Phased view is purely a
  // re-presentation — the total weighted shares is identical.
  const [breakdownView, setBreakdownView] = useState({});
  const isPhased = (id) => breakdownView[id] === 'phased';
  const toggleBreakdownView = (id) =>
    setBreakdownView(prev => ({ ...prev, [id]: prev[id] === 'phased' ? 'audit' : 'phased' }));

  // Re-shape per-investment entries into share COHORTS. Each row tracks a
  // contiguous slice of shares from when they were acquired (purchase /
  // transfer_in / reinvest) to when they left (transfer_out date − 1) or to
  // the reference date if they stayed.
  //
  // Algorithm (per-allocation FIFO):
  //   1. For each allocation, sort additions and subtractions by date.
  //   2. Walk subtractions in order; each one consumes FIFO from the
  //      allocation's earliest-still-available addition.
  //   3. Each consumption produces a cohort row: (taken_shares,
  //      add.payment_date → sub.payment_date − 1, days = sub - add).
  //   4. Any addition shares still unconsumed after all subtractions become
  //      a "stayed until reference" cohort row.
  //
  // The total Σ(shares × days ÷ daysInYear) is identical to the audit view —
  // this is purely a re-presentation.
  //
  // Example: bought 1000 on Sep 10, transferred 500 on Jan 5, transferred
  // 400 on Mar 15, ref June 30 →
  //   500 shares  Sep 10 → Jan 4  (117 days, left in T1)
  //   400 shares  Sep 10 → Mar 14 (186 days, left in T2)
  //   100 shares  Sep 10 → Jun 30 (294 days, stayed — inclusive of both ends)
  const computePhasedRows = (entries, daysInYear, referenceDate) => {
    if (!entries?.length) return [];
    const refDate = referenceDate ? dayjs(referenceDate).startOf('day') : dayjs().startOf('day');
    const dY = daysInYear || 365;

    // Bucket per allocation_id (with a stable 'unknown' bucket for legacy
    // rows). Within each bucket we'll FIFO-consume subs from adds.
    const byAlloc = new Map();
    for (const e of entries) {
      const key = e.allocation_id || `unknown-${e.allocation_no || ''}`;
      if (!byAlloc.has(key)) byAlloc.set(key, { adds: [], subs: [] });
      const n = Number(e.shares || 0);
      const wrapped = { ...e, _remaining: Math.abs(n) };
      if (n > 0) byAlloc.get(key).adds.push(wrapped);
      else if (n < 0) byAlloc.get(key).subs.push(wrapped);
    }
    // Sort each bucket by date.
    for (const bucket of byAlloc.values()) {
      bucket.adds.sort((a, b) => dayjs(a.payment_date).valueOf() - dayjs(b.payment_date).valueOf());
      bucket.subs.sort((a, b) => dayjs(a.payment_date).valueOf() - dayjs(b.payment_date).valueOf());
    }

    const cohorts = [];
    // Audit-equivalent days for a single calendar date relative to the
    // reference. Matches backend daysHeld semantics: acquisition day AND
    // reference day are BOTH counted (inclusive, hence + 1); never exceeds dY.
    // In consumption cohorts the + 1 cancels in auditDays(add) − auditDays(sub),
    // so only "stayed" cohorts and same-date edges shift by a day.
    const auditDays = (d) => Math.min(dY, Math.max(0, refDate.diff(d, 'day') + 1));

    const pushConsumption = (p, sub, take) => {
      const addDate = dayjs(p.payment_date).startOf('day');
      const subDate = dayjs(sub.payment_date).startOf('day');
      // FY-counted days for this cohort:
      //   audit math gives this cohort
      //     shares × (auditDays(add) − auditDays(sub)) ÷ dY
      //   which is the correct decomposition of the per-investment formula
      //   the backend uses. Two events both older than dY days clamp to the
      //   same auditDays and the cohort contributes zero (matches audit).
      const aAdd = auditDays(addDate);
      const aSub = auditDays(subDate);
      // SIGNED, no max(0) clamp. fyDays is normally positive (acquired before
      // it left). It goes NEGATIVE only when the outflow is effective-dated
      // BEFORE the inflow (the transfer_out's AgreedDividendDate is earlier
      // than the transfer_in's date). That negative is a real audit
      // contribution — clamping it to 0 would make the cohort total diverge
      // from the audit total. Keeping it signed guarantees they reconcile.
      const fyDays = aAdd - aSub;
      const inverted = fyDays < 0;
      // Raw ownership length for display. Signed too, so an inverted lot
      // reads honestly.
      const rawDays = subDate.diff(addDate, 'day');
      // "preFY": both endpoints clamped at dY → entirely outside the FY
      // window. Contributes zero and was processed in the prior FY. Hidden.
      const preFY = aAdd === dY && aSub === dY;
      cohorts.push({
        key: `c-${p.investment_id}-${sub.investment_id}`,
        shares: take,
        startDate: addDate,
        endDate: rawDays > 0 ? subDate.subtract(1, 'day') : subDate,
        days: fyDays,
        rawDays,
        weighted: take * fyDays / dY,
        sourceKind: p.kind,
        sourceAlloc: p.allocation_no,
        sourceInvId: p.investment_id,
        outcomeKind: sub.kind,
        outcomeRef: sub.reference_no,
        outcomeInvId: sub.investment_id,
        outcomeDate: subDate,
        stayed: false,
        sameDay: rawDays === 0,
        inverted,
        crossAlloc: p.allocation_id !== sub.allocation_id,
        preFY,
      });
    };

    // Phase 1 — per-allocation FIFO (the common, correct case).
    for (const bucket of byAlloc.values()) {
      for (const sub of bucket.subs) {
        for (const p of bucket.adds) {
          if (sub._remaining <= 0) break;
          if (p._remaining <= 0) continue;
          const take = Math.min(p._remaining, sub._remaining);
          pushConsumption(p, sub, take);
          p._remaining -= take;
          sub._remaining -= take;
        }
      }
    }

    // Phase 2 — global FIFO fallback for any sub left unconsumed. Happens
    // when the transfer_out's allocation_id doesn't line up with where the
    // shareholder actually got those shares (data inconsistency or legacy
    // unlinked-pool transfers). Without this, the cohort total would fall
    // short of the audit total and the user sees mismatched numbers.
    const globalAdds = [];
    for (const bucket of byAlloc.values()) {
      for (const p of bucket.adds) if (p._remaining > 0) globalAdds.push(p);
    }
    globalAdds.sort((a, b) => dayjs(a.payment_date).valueOf() - dayjs(b.payment_date).valueOf());
    for (const bucket of byAlloc.values()) {
      for (const sub of bucket.subs) {
        if (sub._remaining <= 0) continue;
        for (const p of globalAdds) {
          if (sub._remaining <= 0) break;
          if (p._remaining <= 0) continue;
          const take = Math.min(p._remaining, sub._remaining);
          pushConsumption(p, sub, take);
          p._remaining -= take;
          sub._remaining -= take;
        }
      }
    }

    // Phase 3 — remaining adds → "stayed to reference" cohorts. FY-clamped
    // so an add older than dY days only counts dY (matches audit).
    for (const bucket of byAlloc.values()) {
      for (const p of bucket.adds) {
        if (p._remaining > 0) {
          const addDate = dayjs(p.payment_date).startOf('day');
          const fyDays = auditDays(addDate);
          // Inclusive raw ownership: addDate..refDate counts both ends (+ 1),
          // consistent with the new acquisition-day-counts rule.
          const rawDays = Math.max(0, refDate.diff(addDate, 'day') + 1);
          cohorts.push({
            key: `c-${p.investment_id}-stayed`,
            shares: p._remaining,
            startDate: addDate,
            endDate: refDate,
            days: fyDays,
            rawDays,
            weighted: p._remaining * fyDays / dY,
            sourceKind: p.kind,
            sourceAlloc: p.allocation_no,
            sourceInvId: p.investment_id,
            outcomeKind: null,
            outcomeRef: null,
            outcomeInvId: null,
            outcomeDate: null,
            stayed: true,
            sameDay: rawDays === 0,
            crossAlloc: false,
            preFY: false, // stayed cohorts always contribute to the current FY
          });
        }
      }
    }

    // Phase 4 — orphan subs (transfer_outs with no source anywhere). Surface
    // as a warning row so the operator sees that the audit total includes
    // shares the cohort view couldn't attribute.
    for (const bucket of byAlloc.values()) {
      for (const sub of bucket.subs) {
        if (sub._remaining > 0) {
          const subDate = dayjs(sub.payment_date).startOf('day');
          cohorts.push({
            key: `orphan-${sub.investment_id}`,
            shares: sub._remaining,
            startDate: subDate,
            endDate: subDate,
            days: 0,
            weighted: 0,
            sourceKind: null,
            sourceAlloc: sub.allocation_no,
            sourceInvId: null,
            outcomeKind: sub.kind,
            outcomeRef: sub.reference_no,
            outcomeInvId: sub.investment_id,
            outcomeDate: subDate,
            stayed: false,
            sameDay: true,
            orphan: true,
          });
        }
      }
    }

    cohorts.sort((a, b) => {
      const d = a.startDate.valueOf() - b.startDate.valueOf();
      if (d !== 0) return d;
      const ad = a.outcomeDate ? a.outcomeDate.valueOf() : Number.MAX_SAFE_INTEGER;
      const bd = b.outcomeDate ? b.outcomeDate.valueOf() : Number.MAX_SAFE_INTEGER;
      return ad - bd;
    });
    return cohorts;
  };

  // Print the breakdown in the operator's current view. Opens a new window
  // with the dividend header + active table formatted for paper.
  const handlePrintBreakdown = (dividend, breakdown, useView) => {
    if (!breakdown) { message.warning('Breakdown not loaded yet'); return; }
    const sh = dividend.shareholder || {};
    const refStr = breakdown.reference_date ? dayjs(breakdown.reference_date).format('YYYY-MM-DD') : '—';
    const isPhasedView = useView === 'phased';
    // Print mirrors the on-screen filter: cohorts entirely outside the
    // fiscal year are hidden (zero contribution, counted in the prior FY).
    const phased = isPhasedView
      ? computePhasedRows(breakdown.investments || [], breakdown.days_in_year, breakdown.reference_date).filter(c => !c.preFY)
      : [];
    const w = window.open('', '_blank');
    let body = `<!DOCTYPE html><html><head><title>Dividend Breakdown — ${sh.account_no || ''}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 18px; color: #333; }
        h1 { color: #1a3a5c; margin: 0 0 4px; font-size: 20px; }
        h2 { color: #1a3a5c; margin: 0 0 12px; font-size: 14px; font-weight: normal; }
        .meta { display: flex; gap: 16px; margin-bottom: 12px; font-size: 12px; color: #666; flex-wrap: wrap; }
        .meta b { color: #333; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px; }
        th { background: #1a3a5c; color: #fff; padding: 6px 5px; text-align: left; }
        td { padding: 5px; border-bottom: 1px solid #ddd; }
        tr.tot { background: #f0f5ff; font-weight: 700; }
        td.num { text-align: right; }
        td.neg { color: #cf1322; }
        td.pos { color: #3f8600; }
        @media print { body { margin: 8px; } @page { size: A4 landscape; } }
      </style></head><body>
      <h1>ZEMEN BANK S.C. — Dividend Weighted-Share Breakdown</h1>
      <h2>${isPhasedView ? 'Phased view (net shares per period)' : 'Audit view (per payment event)'}</h2>
      <div class="meta">
        <span><b>Account:</b> ${sh.account_no || '—'}</span>
        <span><b>Name:</b> ${(sh.first_name || '') + ' ' + (sh.middle_name || '') + ' ' + (sh.last_name || '')}</span>
        <span><b>Fiscal Year:</b> ${dividend.fiscal_year || '—'}</span>
        <span><b>Reference Date:</b> ${refStr}</span>
        <span><b>Days in Year:</b> ${breakdown.days_in_year || 365}</span>
        <span><b>DPS:</b> ETB ${Number(breakdown.dividend_per_share || 0).toFixed(4)}</span>
      </div>`;
    if (isPhasedView) {
      body += `<table><thead><tr>
        <th>Period (held)</th><th class="num">Shares</th><th>Allocation</th>
        <th>Source</th><th>Outcome</th>
        <th class="num">Days</th><th class="num">Weighted Shares</th><th>Formula</th>
      </tr></thead><tbody>`;
      let total = 0;
      for (const p of phased) {
        total += p.weighted;
        const sourceLabel = ({ original: 'Purchase', transfer_in: 'Transfer In', dividend: 'Reinvest' })[p.sourceKind] || p.sourceKind;
        const outcomeLabel = p.stayed
          ? 'Stayed to reference'
          : `Transferred ${p.outcomeDate?.format('YYYY-MM-DD')} (${p.outcomeRef || `#${p.outcomeInvId}`})`;
        const wCls = p.weighted < 0 ? 'neg' : 'pos';
        const periodCell = p.inverted
          ? `${p.startDate.format('YYYY-MM-DD')} (in) · ${p.outcomeDate?.format('YYYY-MM-DD')} (out) — outflow before inflow`
          : `${p.startDate.format('YYYY-MM-DD')} → ${p.endDate.format('YYYY-MM-DD')}`;
        body += `<tr>
          <td>${periodCell}</td>
          <td class="num pos">${formatNumber(p.shares)}</td>
          <td>${p.sourceAlloc || '—'}</td>
          <td>${sourceLabel} (Inv #${p.sourceInvId})</td>
          <td>${outcomeLabel}</td>
          <td class="num ${p.days < 0 ? 'neg' : ''}">${p.days}</td>
          <td class="num ${wCls}">${p.weighted.toFixed(4)}</td>
          <td>${p.shares} × ${p.days} ÷ ${breakdown.days_in_year || 365}</td>
        </tr>`;
      }
      body += `<tr class="tot"><td colspan="6">Total weighted shares</td>
        <td class="num">${total.toFixed(4)}</td><td>× ETB ${Number(breakdown.dividend_per_share || 0).toFixed(4)} = ETB ${(total * (breakdown.dividend_per_share || 0)).toFixed(2)}</td>
      </tr></tbody></table>`;
    } else {
      body += `<table><thead><tr>
        <th>Inv #</th><th>Kind</th><th>Allocation</th><th>Reference</th>
        <th class="num">Shares</th><th>Payment Date</th><th>Ending Date</th>
        <th class="num">Days</th><th class="num">Weighted Shares</th><th>Formula</th>
      </tr></thead><tbody>`;
      let total = 0;
      for (const r of breakdown.investments || []) {
        total += Number(r.weighted_shares || 0);
        body += `<tr>
          <td>${r.investment_id}</td><td>${r.kind}</td>
          <td>${r.allocation_no || '—'}</td><td>${r.reference_no || '—'}</td>
          <td class="num ${Number(r.shares) < 0 ? 'neg' : 'pos'}">${formatNumber(r.shares)}</td>
          <td>${r.payment_date ? dayjs(r.payment_date).format('YYYY-MM-DD') : '—'}</td>
          <td>${r.ending_date ? dayjs(r.ending_date).format('YYYY-MM-DD') : '—'}</td>
          <td class="num">${Math.round(r.days_held || 0)}</td>
          <td class="num ${Number(r.weighted_shares) < 0 ? 'neg' : 'pos'}">${Number(r.weighted_shares || 0).toFixed(4)}</td>
          <td>${r.formula || ''}</td>
        </tr>`;
      }
      body += `<tr class="tot"><td colspan="8">Total weighted shares</td>
        <td class="num">${total.toFixed(4)}</td><td>× ETB ${Number(breakdown.dividend_per_share || 0).toFixed(4)} = ETB ${(total * (breakdown.dividend_per_share || 0)).toFixed(2)}</td>
      </tr></tbody></table>`;
    }
    body += `<script>window.onload = () => window.print();</script></body></html>`;
    w.document.write(body);
    w.document.close();
  };

  // Reinvest distribution state — when the Subscribe modal opens we fetch
  // the shareholder's allocations and auto-fill a greedy plan: pay down the
  // oldest unpaid allocation first, spill the rest into the next. The user
  // can adjust per-row before submitting.
  const [subAllocations, setSubAllocations] = useState([]);
  const [subDist, setSubDist] = useState({}); // { [allocation_id]: shares }
  const [subAllocLoading, setSubAllocLoading] = useState(false);

  // Per-row action lock: prevents a double-click on Collect/Block/Release/
  // Transfer/Subscribe from firing the same request twice while the server
  // is still working. Map { [dividendId+action]: true }.
  const [actionLocks, setActionLocks] = useState({});
  const lockKey = (id, action) => `${id}:${action}`;
  const isLocked = (id, action) => !!actionLocks[lockKey(id, action)];
  const withLock = async (id, action, fn) => {
    const k = lockKey(id, action);
    if (actionLocks[k]) return; // already in flight, ignore the extra click
    setActionLocks(prev => ({ ...prev, [k]: true }));
    try {
      await fn();
    } finally {
      // Hold the lock for an extra 5s after the request finishes so a fast
      // server response doesn't immediately allow a fat-finger second submit.
      setTimeout(() => setActionLocks(prev => {
        const next = { ...prev };
        delete next[k];
        return next;
      }), 5000);
    }
  };

  // Excel export state
  const [exportModal, setExportModal] = useState(false);
  const [exportScope, setExportScope] = useState('current'); // 'current' | 'all'
  const [exportCols, setExportCols] = useState(DEFAULT_EXPORT_COLS);
  const [exportLoading, setExportLoading] = useState(false);
  // Shareholder filter: array of { id, label } pairs. When empty -> no filter.
  // The labelInValue option below means the Select keeps the full {id,label}
  // tuples so the chip displays a useful label even if the user removes the
  // search term that originally surfaced this option.
  const [exportShareholders, setExportShareholders] = useState([]);
  const [shSearchOptions, setShSearchOptions] = useState([]);
  const [shSearchLoading, setShSearchLoading] = useState(false);
  const shSearchTimeoutRef = useRef(null);

  const handleShareholderSearch = (val) => {
    if (shSearchTimeoutRef.current) clearTimeout(shSearchTimeoutRef.current);
    if (!val || val.length < 2) {
      setShSearchOptions([]);
      return;
    }
    shSearchTimeoutRef.current = setTimeout(async () => {
      setShSearchLoading(true);
      try {
        const res = await searchShareholders(val);
        setShSearchOptions((res.data?.data || []).map(s => ({
          value: s.id,
          label: `${s.account_no || `#${s.id}`} — ${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''}`.replace(/\s+/g, ' ').trim(),
        })));
      } catch { setShSearchOptions([]); }
      setShSearchLoading(false);
    }, 300);
  };

  const handleExport = async () => {
    if (exportCols.length === 0) {
      message.error('Pick at least one column to export.');
      return;
    }
    setExportLoading(true);
    try {
      // Decide row source: the current visible page, or everything matching
      // the current fiscal-year filter. For "all", request the full count
      // in one shot using page_size = total (capped so an unbounded result
      // doesn't kill the browser).
      let rows = data;
      if (exportScope === 'all') {
        const pageSize = Math.max(total || 0, 1);
        if (pageSize > 10000) {
          message.warning(`Exporting ${pageSize.toLocaleString()} rows — this may take a moment.`);
        }
        const res = await getDividends({ page: 1, page_size: pageSize, fiscal_year: fiscalYear });
        rows = res.data?.data || [];
      }

      // Shareholder filter (client-side). When non-empty, keep only rows
      // whose shareholder_id is in the selected set.
      if (exportShareholders.length > 0) {
        const allowed = new Set(exportShareholders.map(s => s.value));
        rows = rows.filter(r => allowed.has(r.shareholder_id ?? r.shareholder?.id));
      }

      if (rows.length === 0) {
        message.warning('No rows match the selected filters. Nothing to export.');
        setExportLoading(false);
        return;
      }

      const cols = EXPORT_COLUMNS.filter(c => exportCols.includes(c.key));
      const headers = cols.map(c => c.label);
      const dataRows = rows.map(r => cols.map(c => {
        const v = c.getter(r);
        // Coerce undefined/null to empty so Excel cells aren't literal "undefined"
        return v == null ? '' : v;
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);

      // Auto-width columns based on the longest cell content per column.
      const colWidths = headers.map((h, i) => {
        let max = String(h).length;
        for (const row of dataRows) {
          const len = String(row[i] ?? '').length;
          if (len > max) max = len;
        }
        return { wch: Math.min(Math.max(max + 2, 8), 40) };
      });
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'Dividends');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const scopeTag = exportScope === 'all' ? 'all' : `p${page}`;
      const yearTag = fiscalYear || 'all-years';
      saveAs(
        new Blob([buf], { type: 'application/octet-stream' }),
        `dividends-${yearTag}-${scopeTag}-${dayjs().format('YYYY-MM-DD-HHmm')}.xlsx`,
      );
      message.success(`Exported ${rows.length.toLocaleString()} row${rows.length === 1 ? '' : 's'}`);
      setExportModal(false);
    } catch (e) {
      message.error(e.response?.data?.error || 'Export failed');
    } finally {
      setExportLoading(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeFilters) {
        const res = await searchDividendsAdvanced({ filters: activeFilters, page, page_size: 20 });
        setData(res.data.data || []);
        setTotal(res.data.total || 0);
      } else {
        const res = await getDividends({ page, page_size: 20, fiscal_year: fiscalYear });
        setData(res.data.data || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) { message.error(err.response?.data?.error || 'Failed to load'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page, fiscalYear, activeFilters]);

  const runAdvancedSearch = (cleaned) => {
    if (cleaned.length === 0) { message.warning('Add at least one filter.'); return; }
    setPage(1);
    setActiveFilters(cleaned);
  };
  const resetAdvancedSearch = () => { setActiveFilters(null); setPage(1); };

  const loadExpanded = async (dividendId) => {
    if (expandedCache[dividendId]?.breakdown && expandedCache[dividendId]?.history) return;
    try {
      const [b, h] = await Promise.all([
        getDividendBreakdown(dividendId),
        getDividendHistory(dividendId),
      ]);
      setExpandedCache(prev => ({
        ...prev,
        [dividendId]: { breakdown: b.data, history: h.data?.data || [] },
      }));
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to load detail');
    }
  };

  const refreshExpanded = (dividendId) => {
    setExpandedCache(prev => { const next = { ...prev }; delete next[dividendId]; return next; });
  };

  // Modal submit guard: lock for 5s per modal so a flaky network + impatient
  // operator can't fire the same Collect / Transfer twice.
  const [collectSubmitting, setCollectSubmitting] = useState(false);
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  const handleCollect = async (values) => {
    if (collectSubmitting) return;
    setCollectSubmitting(true);
    try {
      await collectDividend(collectModal.id, values);
      message.success('Dividend collected');
      refreshExpanded(collectModal.id);
      setCollectModal(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
    setTimeout(() => setCollectSubmitting(false), 5000);
  };

  const handleBlock = async (id) => {
    await blockDividend(id, { reason: 'Blocked by admin' });
    message.success('Blocked');
    refreshExpanded(id);
    fetchData();
  };

  const handleRelease = async (id) => {
    await releaseDividend(id);
    message.success('Released');
    refreshExpanded(id);
    fetchData();
  };

  const handleTransfer = async (values) => {
    if (transferSubmitting) return;
    setTransferSubmitting(true);
    try {
      await transferDividend(transferModal.id, values);
      message.success('Transfer request queued for authorization');
      refreshExpanded(transferModal.id);
      setTransferModal(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
    setTimeout(() => setTransferSubmitting(false), 5000);
  };

  // Opens the Subscribe / Reinvest modal AND eagerly fetches the
  // shareholder's allocations so we can render the per-allocation
  // distribution table. The "greedy plan" auto-fills the dialog: pay down
  // the oldest unpaid allocation first, spill any remainder into the next.
  const openSubscribeModal = async (dividend, reinvestable) => {
    setSubscribeModal(dividend);
    subscribeForm.resetFields();
    subscribeForm.setFieldsValue({
      reinvest_amount: Math.max(0, reinvestable),
      additional_amount: 0,
      additional_payment_method: 'cash',
    });
    setSubAllocations([]);
    setSubDist({});
    setSubAllocLoading(true);
    try {
      const res = await getShareholderInvestmentSummary(
        dividend.shareholder_id ?? dividend.shareholder?.id,
      );
      const allocs = (res.data?.allocations || []).filter(
        a => a.payment_status !== 'fully_paid' && a.approval_status === 'approved'
      );
      // Oldest first for FIFO-style fill (mirrors how computeAllocPaidShares
      // walks the pool on the backend).
      allocs.sort((a, b) => (a.id || 0) - (b.id || 0));
      setSubAllocations(allocs);
      autoDistribute(allocs, reinvestable, parValue, 0);
    } catch (e) {
      message.error('Failed to load allocations: ' + (e.response?.data?.error || e.message));
    } finally {
      setSubAllocLoading(false);
    }
  };

  // Greedy fill: max amount = reinvest + additional. Spread the resulting
  // share count across allocations starting with the oldest, capped by each
  // allocation's unpaid_after_pending capacity.
  const autoDistribute = (allocs, reinvestAmt, par, additionalAmt) => {
    if (!par || par <= 0) return;
    const total = (reinvestAmt || 0) + (additionalAmt || 0);
    let sharesLeft = Math.floor(total / par);
    const next = {};
    for (const a of allocs) {
      const unpaid = Math.max(
        0,
        (a.allocated_shares || 0) - (a.paid_shares || 0) - (a.pending_shares || 0),
      );
      const take = Math.min(sharesLeft, unpaid);
      if (take > 0) {
        next[a.id] = take;
        sharesLeft -= take;
      }
      if (sharesLeft <= 0) break;
    }
    setSubDist(next);
  };

  const handleSubscribe = async (values) => {
    try {
      const distributions = Object.entries(subDist)
        .map(([allocId, shares]) => ({ allocation_id: Number(allocId), shares: Number(shares || 0) }))
        .filter(d => d.shares > 0);

      if (distributions.length === 0) {
        message.error('Distribute at least 1 share to one of your allocations before submitting.');
        return;
      }
      const totalShares = distributions.reduce((s, d) => s + d.shares, 0);
      const totalAmount = totalShares * (parValue || 0);
      const reinvest = Number(values.reinvest_amount ?? 0);
      const additional = Number(values.additional_amount ?? 0);

      // Enforce funding == distribution amount with a 0.5 ETB slack
      if (Math.abs(reinvest + additional - totalAmount) > 0.5) {
        message.error(
          `Funding (${(reinvest + additional).toLocaleString()}) doesn't match distribution (${totalAmount.toLocaleString()}). Hit "Auto-fill from amount" to sync.`,
        );
        return;
      }

      const payload = {
        reinvest_amount: reinvest,
        additional_amount: additional,
        additional_payment_method: values.additional_payment_method || 'cash',
        from_account: values.from_account || '',
        reference_no: values.reference_no || '',
        remark: values.remark || '',
        distributions,
      };
      await reinvestDividend(subscribeModal.id, payload);
      message.success('Reinvestment recorded — investments created (pending approval). No new allocation made.');
      refreshExpanded(subscribeModal.id);
      setSubscribeModal(null);
      setSubAllocations([]);
      setSubDist({});
      subscribeForm.resetFields();
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  // Live values are the recomputed numbers based on the CURRENT investment
  // state (so a transfer that happened after dividend processing is reflected).
  // The stored values from processing-time live in `weighted_avg_shares` /
  // `gross_dividend` / `tax_amount` / `net_dividend` and are shown as a tooltip
  // for audit comparison when the two differ.
  const cellWithLive = (live, stored, fmt) => {
    const liveN = Number(live ?? 0);
    const storedN = Number(stored ?? 0);
    const differs = Math.abs(liveN - storedN) > 0.005;
    const liveStr = fmt(liveN);
    if (!differs) return liveStr;
    return (
      <Tooltip title={<>Stored at processing: <strong>{fmt(storedN)}</strong>. Live reflects current state.</>}>
        <Space size={4} direction="vertical" style={{ lineHeight: 1.2 }}>
          <Text strong>{liveStr}</Text>
          <Text type="secondary" style={{ fontSize: 11, textDecoration: 'line-through' }}>{fmt(storedN)}</Text>
        </Space>
      </Tooltip>
    );
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 50 },
    { title: 'Sh. ID', key: 'shid', width: 75, render: (_, r) => r.shareholder_id ?? r.shareholder?.id ?? '-' },
    { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
    { title: 'Fiscal Year', dataIndex: 'fiscal_year', width: 100 },
    { title: 'W.Avg Shares', key: 'wavg', width: 120, render: (_, r) => cellWithLive(r.live_weighted_shares, r.weighted_avg_shares, v => Number(v).toFixed(4)) },
    { title: 'Gross', key: 'gross', render: (_, r) => cellWithLive(r.live_gross_dividend, r.gross_dividend, v => formatCurrency(v)) },
    { title: 'Reinvested', dataIndex: 'reinvested_amount', render: (v) => v > 0 ? <Text style={{ color: '#1677ff' }}>{formatCurrency(v)}</Text> : '—' },
    { title: 'Tax', key: 'tax', render: (_, r) => cellWithLive(r.live_tax_amount, r.tax_amount, v => formatCurrency(v)) },
    { title: 'Net', key: 'net', render: (_, r) => cellWithLive(r.live_net_dividend, r.net_dividend, v => formatCurrency(v)) },
    { title: 'Collected', dataIndex: 'collected_amount', render: (v) => formatCurrency(v) },
    { title: 'Uncollected', key: 'uncollected', render: (_, r) => cellWithLive(r.live_uncollected, r.uncollected_amount, v => formatCurrency(v)) },
    {
      title: 'Status', key: 'status', width: 100,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Tag color={r.status === 'collected' ? 'green' : r.status === 'partial' ? 'blue' : r.status === 'transferred' ? 'purple' : r.status === 'settled' ? 'green' : 'orange'}>{r.status}</Tag>
          {r.is_blocked && <Tag color="red">BLOCKED</Tag>}
          {r.is_transferred && <Tag color="purple">To: {r.transfer_to}</Tag>}
        </Space>
      ),
    },
    {
      title: 'Actions', key: 'actions', width: 280,
      render: (_, r) => {
        const reinvestable = (r.gross_dividend - (r.reinvested_amount || 0) - (r.collected_amount || 0));
        const fullyConsumed = (
          r.status === 'collected' ||
          r.status === 'settled' ||
          r.is_transferred ||
          (reinvestable <= 0.005 && (r.uncollected_amount || 0) <= 0.005)
        );

        // Pending-transfer trumps every other action. Operator must wait
        // for the Authorization tab to approve or reject before this row
        // is interactable again.
        if (r.is_transfer_pending) {
          return <Tag color="orange" style={{ fontSize: 11 }}>Transfer pending approval</Tag>;
        }

        // Strict rule: when blocked → only Release. Block button gone
        // until the block is cleared.
        if (r.is_blocked) {
          return (
            <Space wrap>
              <Button size="small"
                loading={isLocked(r.id, 'release')}
                disabled={isLocked(r.id, 'release')}
                onClick={() => withLock(r.id, 'release', () => handleRelease(r.id))}>
                Release
              </Button>
            </Space>
          );
        }

        if (fullyConsumed) {
          return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        }

        return (
          <Space wrap>
            {reinvestable > 0 && (
              <Button size="small" type="primary" icon={<RiseOutlined />}
                loading={isLocked(r.id, 'subscribe')}
                disabled={isLocked(r.id, 'subscribe')}
                onClick={() => withLock(r.id, 'subscribe', () => openSubscribeModal(r, reinvestable))}>
                Subscribe
              </Button>
            )}
            {r.uncollected_amount > 0 && (
              <Button size="small"
                loading={isLocked(r.id, 'collect')}
                disabled={isLocked(r.id, 'collect')}
                onClick={() => {
                  setCollectModal(r);
                  form.setFieldsValue({ amount: r.uncollected_amount, payment_method: 'cash' });
                }}>Collect</Button>
            )}
            <Popconfirm title="Block dividend?"
              onConfirm={() => withLock(r.id, 'block', () => handleBlock(r.id))}>
              <Button size="small" danger
                loading={isLocked(r.id, 'block')}
                disabled={isLocked(r.id, 'block')}>
                Block
              </Button>
            </Popconfirm>
            <Button size="small"
              loading={isLocked(r.id, 'transfer')}
              disabled={isLocked(r.id, 'transfer')}
              onClick={() => { setTransferModal(r); transferForm.resetFields(); }}>
              Transfer
            </Button>
          </Space>
        );
      },
    },
  ];

  // Expandable row: per-allocation weighted-average breakdown + action history
  const expandedRowRender = (record) => {
    const entry = expandedCache[record.id];
    if (!entry) return <Text type="secondary">Loading...</Text>;
    const b = entry.breakdown;
    const h = entry.history;

    return (
      <div>
        <Card size="small" title={<><CalculatorOutlined /> Weighted-Average Breakdown (per payment)</>}
          style={{ marginBottom: 12 }}
          extra={
            <Space size={12} wrap>
              <Space size={4}>
                <Text type="secondary" style={{ fontSize: 12 }}>View:</Text>
                <Switch
                  size="small"
                  checked={isPhased(record.id)}
                  onChange={() => toggleBreakdownView(record.id)}
                  checkedChildren="Cohort"
                  unCheckedChildren="Audit"
                />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {isPhased(record.id) ? 'positive cohorts (per share lot)' : 'per-event with negatives'}
                </Text>
              </Space>
              <Button size="small" icon={<PrinterOutlined />}
                onClick={() => handlePrintBreakdown(record, b, isPhased(record.id) ? 'phased' : 'audit')}>
                Print
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>Formula: {b?.formula_label}</Text>
            </Space>
          }>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Each row below is ONE payment event"
            description={
              <div>
                <div>Sum of <code>shares × days_held ÷ days_in_year</code> across every investment.</div>
                <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 18 }}>
                  <li><strong>Partial payments:</strong> a chunk paid Sep 15 contributes only from Sep 15 → reference date. A chunk paid Jan 15 gets the full year.</li>
                  <li><strong>Transferred shares:</strong> both transferor and transferee see rows dated to the <em>Dividend From Share Transfer Date</em> (the <code>AgreedDividendDate</code> on the transfer). The seller's <Tag color="red" style={{ marginRight: 2 }}>transfer_out</Tag> row is negative — it cancels their credit from that date forward. The buyer's <Tag color="green" style={{ marginLeft: 0 }}>transfer_in</Tag> row earns credit only from that date forward. The math splits the year cleanly between them.</li>
                  <li><strong>Dividend reinvestments:</strong> appear as <Tag color="cyan">dividend</Tag> rows dated when the reinvest action was recorded.</li>
                </ul>
              </div>
            }
          />
          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col span={6}><Statistic title="Days in Year" value={b?.days_in_year} /></Col>
            <Col span={6}><Statistic title="Reference Date" valueRender={() => b?.reference_date ? dayjs(b.reference_date).format('YYYY-MM-DD') : '—'} value={1} /></Col>
            <Col span={6}><Statistic title="DPS (fixed at processing)" value={b?.dividend_per_share} prefix="ETB" precision={4} /></Col>
            <Col span={6}>
              <Statistic
                title="Total Weighted Shares (live)"
                value={b?.live?.weighted_shares ?? b?.total_weighted_shares}
                precision={4}
                valueStyle={{ color: '#d32f2f' }}
              />
            </Col>
          </Row>

          {/* Stored vs Live comparison — admin can see exactly how much the transfer / payment events changed the entitlement */}
          {b?.live && b?.stored && (
            <Descriptions
              bordered size="small" column={4}
              style={{ marginBottom: 12, background: '#fff' }}
              title={<Text type="secondary" style={{ fontSize: 13 }}>Stored at processing vs Live (current state)</Text>}
            >
              <Descriptions.Item label="W.Avg Shares (stored)">{Number(b.stored.weighted_shares || 0).toFixed(4)}</Descriptions.Item>
              <Descriptions.Item label="W.Avg Shares (live)"><Text strong style={{ color: '#d32f2f' }}>{Number(b.live.weighted_shares || 0).toFixed(4)}</Text></Descriptions.Item>
              <Descriptions.Item label="Gross (stored)">{formatCurrency(b.stored.gross)}</Descriptions.Item>
              <Descriptions.Item label="Gross (live)"><Text strong style={{ color: '#d32f2f' }}>{formatCurrency(b.live.gross)}</Text></Descriptions.Item>
              <Descriptions.Item label="Tax (stored)">{formatCurrency(b.stored.tax)}</Descriptions.Item>
              <Descriptions.Item label="Tax (live)"><Text strong style={{ color: '#d32f2f' }}>{formatCurrency(b.live.tax)}</Text></Descriptions.Item>
              <Descriptions.Item label="Net (stored)">{formatCurrency(b.stored.net)}</Descriptions.Item>
              <Descriptions.Item label="Net (live)"><Text strong style={{ color: '#d32f2f' }}>{formatCurrency(b.live.net)}</Text></Descriptions.Item>
            </Descriptions>
          )}
          {isPhased(record.id) ? (() => {
            const cohortRowsAll = computePhasedRows(b?.investments || [], b?.days_in_year, b?.reference_date);
            // Hide cohorts that fall entirely OUTSIDE the fiscal year window.
            // They contribute zero to this dividend (already counted in the
            // prior FY's processing) and just clutter the view.
            const cohortRows = cohortRowsAll.filter(c => !c.preFY);
            const hiddenCount = cohortRowsAll.length - cohortRows.length;
            const cohortTotal = cohortRowsAll.reduce((s, r) => s + Number(r.weighted || 0), 0);
            const auditTotal = (b?.investments || []).reduce((s, r) => s + Number(r.weighted_shares || 0), 0);
            const matches = Math.abs(cohortTotal - auditTotal) < 0.0005;
            return (
              <>
                <Alert
                  type={matches ? 'success' : 'warning'}
                  showIcon
                  style={{ marginBottom: 8 }}
                  message={matches
                    ? `Cohort total matches Audit total: ${cohortTotal.toFixed(4)} weighted shares.`
                    : `Cohort total (${cohortTotal.toFixed(4)}) differs from Audit total (${auditTotal.toFixed(4)}) by ${(cohortTotal - auditTotal).toFixed(4)}. Look for ⚠ orphan rows — they flag transfer_outs whose source the cohort view couldn't locate.`
                  }
                  description={hiddenCount > 0
                    ? `${hiddenCount} cohort row${hiddenCount === 1 ? '' : 's'} hidden because they fall entirely before this fiscal year — they're zero-contribution here and were processed in the previous FY's dividend.`
                    : null
                  }
                />
                <Table
                  dataSource={cohortRows}
              rowKey="key"
              size="small"
              pagination={false}
              columns={[
                { title: 'Period (held)', key: 'period', render: (_, p) => (
                  <div>
                    {p.inverted ? (
                      <>
                        <div><Text strong>{p.startDate.format('YYYY-MM-DD')}</Text> (in) · <Text strong>{p.outcomeDate?.format('YYYY-MM-DD')}</Text> (out)</div>
                        <Text type="danger" style={{ fontSize: 11 }}>outflow dated before inflow · {p.days} d</Text>
                      </>
                    ) : p.sameDay && !p.orphan ? (
                      <>
                        <div><Text strong>{p.startDate.format('YYYY-MM-DD')}</Text></div>
                        <Text type="secondary" style={{ fontSize: 11 }}>same-day · 0 days</Text>
                      </>
                    ) : (
                      <>
                        <div><Text strong>{p.startDate.format('YYYY-MM-DD')}</Text> → <Text strong>{p.endDate.format('YYYY-MM-DD')}</Text></div>
                        <Text type="secondary" style={{ fontSize: 11 }}>{p.days} days{p.crossAlloc ? ' · cross-allocation' : ''}</Text>
                      </>
                    )}
                  </div>
                ) },
                { title: 'Shares', dataIndex: 'shares', render: v => (
                  <Text strong style={{ color: '#3f8600' }}>{formatNumber(v)}</Text>
                ) },
                { title: 'Allocation', dataIndex: 'sourceAlloc', render: v => v || '—' },
                { title: 'Source', key: 'source', render: (_, p) => {
                  if (p.orphan) {
                    return <Tag color="warning">⚠ orphan transfer</Tag>;
                  }
                  const map = {
                    original:     { color: 'default', label: 'Purchase' },
                    transfer_in:  { color: 'green',   label: 'Transfer In' },
                    dividend:     { color: 'cyan',    label: 'Reinvest' },
                  };
                  const m = map[p.sourceKind] || { color: 'default', label: p.sourceKind };
                  return (
                    <Space direction="vertical" size={0}>
                      <Tag color={m.color}>{m.label}</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>Inv #{p.sourceInvId}</Text>
                    </Space>
                  );
                }},
                { title: 'Outcome', key: 'outcome', render: (_, p) => {
                  if (p.stayed) return <Tag color="blue">Stayed to reference</Tag>;
                  return (
                    <Space direction="vertical" size={0}>
                      <Tag color="red">Transferred {p.outcomeDate?.format('YYYY-MM-DD')}</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>{p.outcomeRef || `Inv #${p.outcomeInvId}`}</Text>
                    </Space>
                  );
                }},
                { title: 'Days (counted)', key: 'days', render: (_, p) => (
                  <div>
                    <Text strong style={{ color: p.days < 0 ? '#cf1322' : undefined }}>{p.days}</Text>
                    {p.rawDays != null && p.rawDays !== p.days && !p.inverted && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {p.days === 0 ? `${p.rawDays} d held, all outside FY` : `actual ${p.rawDays} d, FY-clamped`}
                        </Text>
                      </div>
                    )}
                  </div>
                )},
                { title: 'Weighted Shares', dataIndex: 'weighted',
                  render: v => <Text strong style={{ color: Number(v) < 0 ? '#cf1322' : '#3f8600' }}>{Number(v).toFixed(4)}</Text>
                },
                { title: 'Formula', key: 'formula',
                  render: (_, p) => <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {p.shares} × {p.days} ÷ {b?.days_in_year || 365}
                  </Text> },
              ]}
              summary={(rows) => {
                const total = rows.reduce((s, r) => s + Number(r.weighted || 0), 0);
                return (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={6}><Text strong>Total weighted shares</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={1}><Text strong style={{ color: '#d32f2f' }}>{total.toFixed(4)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={2}><Text type="secondary">× ETB {Number(b?.dividend_per_share || 0).toFixed(4)} = ETB {(total * Number(b?.dividend_per_share || 0)).toFixed(2)}</Text></Table.Summary.Cell>
                  </Table.Summary.Row>
                );
              }}
            />
              </>
            );
          })() : (
          <Table
            dataSource={b?.investments || []}
            rowKey="investment_id"
            size="small"
            pagination={false}
            rowClassName={(r) => r.kind === 'transfer_in' ? 'div-row-transfer-in' : r.kind === 'transfer_out' ? 'div-row-transfer-out' : ''}
            columns={[
              { title: 'Inv #', dataIndex: 'investment_id', width: 70 },
              { title: 'Kind', dataIndex: 'kind', width: 110, render: k => {
                const map = {
                  transfer_in:  { color: 'green',   label: 'Transfer In'  },
                  transfer_out: { color: 'red',     label: 'Transfer Out' },
                  dividend:     { color: 'cyan',    label: 'Reinvest'     },
                  original:     { color: 'default', label: 'Purchase'     },
                };
                const m = map[k] || map.original;
                return <Tag color={m.color}>{m.label}</Tag>;
              } },
              { title: 'Allocation', dataIndex: 'allocation_no', render: (v, r) => v || (r.allocation_id ? `#${r.allocation_id}` : '—') },
              { title: 'Reference', dataIndex: 'reference_no', render: v => v || '—' },
              { title: 'Method', dataIndex: 'payment_method', render: v => v ? <Tag>{v}</Tag> : '—' },
              { title: 'Shares (this payment)', dataIndex: 'shares', render: v => {
                const n = Number(v);
                return <Text strong style={{ color: n < 0 ? '#cf1322' : n > 0 ? '#3f8600' : undefined }}>
                  {n > 0 ? '+' : ''}{formatNumber(v)}
                </Text>;
              } },
              { title: 'Amount (at company par)', key: 'book_amount',
                render: (_, r) => {
                  const book = Number(r.book_amount ?? 0);
                  const stored = Number(r.amount ?? 0);
                  const differs = Math.abs(book - stored) > 0.005;
                  const cell = (
                    <Text style={{ color: book < 0 ? '#cf1322' : book > 0 ? '#3f8600' : undefined }}>
                      {formatCurrency(book)}
                    </Text>
                  );
                  if (!differs) return cell;
                  // Transfer row — paid at transfer par but valued at company par
                  return (
                    <Tooltip title={
                      <div>
                        <div>Book value at company par (ETB {Number(r.company_par_value || 0).toLocaleString()}/share): <strong>{formatCurrency(book)}</strong></div>
                        <div>Actually paid at transfer par (ETB {Number(r.par_value || 0).toLocaleString()}/share): <strong>{formatCurrency(stored)}</strong></div>
                      </div>
                    }>
                      <Space size={4} direction="vertical" style={{ lineHeight: 1.2 }}>
                        {cell}
                        <Text type="secondary" style={{ fontSize: 10 }}>paid: {formatCurrency(stored)}</Text>
                      </Space>
                    </Tooltip>
                  );
                }
              },
              { title: 'Payment / Eligible From', dataIndex: 'payment_date',
                render: (d, r) => d ? (
                  <div>
                    <div>{dayjs(d).format('YYYY-MM-DD')}</div>
                    {(r.kind === 'transfer_in' || r.kind === 'transfer_out') && (
                      <Text type="secondary" style={{ fontSize: 11 }}>Dividend From Share Transfer Date</Text>
                    )}
                  </div>
                ) : '—'
              },
              { title: 'Ending Date', dataIndex: 'ending_date', render: d => d ? dayjs(d).format('YYYY-MM-DD') : '—' },
              { title: 'Days Held', dataIndex: 'days_held', render: v => Math.round(v) },
              { title: 'Weighted Shares', dataIndex: 'weighted_shares', render: (v, r) => {
                const n = Number(v);
                return <Text strong style={{ color: n < 0 ? '#cf1322' : n > 0 ? '#3f8600' : undefined }}>
                  {n > 0 ? '+' : ''}{n.toFixed(4)}
                </Text>;
              } },
              { title: 'Formula', dataIndex: 'formula', render: f => <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>{f}</Text> },
            ]}
            summary={(rows) => {
              const total = rows.reduce((s, r) => s + Number(r.weighted_shares || 0), 0);
              return (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={8}><Text strong>Total weighted shares</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1}><Text strong style={{ color: '#d32f2f' }}>{total.toFixed(4)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={2}><Text type="secondary">× ETB {Number(b?.dividend_per_share || 0).toFixed(4)} = ETB {Number(b?.computed_gross || 0).toFixed(2)}</Text></Table.Summary.Cell>
                </Table.Summary.Row>
              );
            }}
          />
          )}
        </Card>

        <Card size="small" title={<><HistoryOutlined /> Action History</>}>
          {h.length === 0 ? <Text type="secondary">No actions recorded yet.</Text> : (
            <Table
              dataSource={h}
              rowKey="id"
              size="small"
              pagination={false}
              columns={[
                { title: 'When', dataIndex: 'acted_at', width: 160, render: d => d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '—' },
                { title: 'Action', dataIndex: 'action_type', width: 110, render: t => {
                  const colors = { collect: 'green', block: 'red', release: 'blue', transfer: 'purple', reinvest: 'cyan', tax_return: 'orange', payment_return: 'orange' };
                  return <Tag color={colors[t] || 'default'}>{t}</Tag>;
                } },
                { title: 'Amount', dataIndex: 'amount', render: v => v ? formatCurrency(v) : '—' },
                { title: 'Tax Impact', dataIndex: 'tax_impact', render: v => v ? <Text style={{ color: v < 0 ? '#3f8600' : '#cf1322' }}>{formatCurrency(v)}</Text> : '—' },
                { title: 'Method', dataIndex: 'payment_method', render: v => v || '—' },
                { title: 'Description', dataIndex: 'description', ellipsis: true },
                { title: 'Note', dataIndex: 'remark', ellipsis: true },
              ]}
            />
          )}
        </Card>
      </div>
    );
  };

  // Live preview for the Subscribe modal — combine first, THEN floor. The
  // residual from reinvest's fractional share crosses over to the additional
  // amount so the user can complete the next whole share with a small top-up.
  const SubscribePreview = ({ dividend, form: f, parValue }) => {
    const reinvest = Form.useWatch('reinvest_amount', f);
    const additional = Form.useWatch('additional_amount', f);
    if (!dividend || !parValue) return null;
    const reinvestNum = Number(reinvest) || 0;
    const additionalNum = Number(additional) || 0;

    const combined = reinvestNum + additionalNum;
    const totalShares = Math.floor(combined / parValue);
    const totalUsed = totalShares * parValue;
    const totalResidual = combined - totalUsed;
    const nextShareNeed = parValue - totalResidual; // top-up to reach the next whole share

    // Consume reinvest first — anything reinvest can't fund is paid by additional.
    const reinvestUsed = Math.min(reinvestNum, totalUsed);
    const additionalUsed = totalUsed - reinvestUsed;

    // "Logical" share split for display only (Investment row is one combined entry server-side).
    const cleanReinvestShares = Math.floor(reinvestNum / parValue);
    const cleanAdditionalShares = Math.floor(additionalNum / parValue);
    const bridgeShare = Math.max(0, totalShares - cleanReinvestShares - cleanAdditionalShares);
    const reinvestShares = cleanReinvestShares + (additionalNum > 0 ? 0 : bridgeShare);
    const additionalShares = cleanAdditionalShares + (additionalNum > 0 ? bridgeShare : 0);

    if (totalShares === 0) {
      return (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message="Amount too small to buy a whole share"
          description={`At par value ETB ${parValue.toLocaleString()} per share, you need at least ETB ${parValue.toLocaleString()} combined to produce one share.`}
        />
      );
    }

    return (
      <Alert
        type={totalResidual > 0.005 ? 'warning' : 'success'}
        showIcon
        style={{ marginTop: 12 }}
        message={<>Will create <strong>{totalShares.toLocaleString()}</strong> whole share{totalShares === 1 ? '' : 's'} for ETB {totalUsed.toLocaleString(undefined, { minimumFractionDigits: 2 })}</>}
        description={
          <div style={{ fontSize: 13 }}>
            <div>From this dividend: <Text strong>{reinvestShares.toLocaleString()}</Text> share{reinvestShares === 1 ? '' : 's'} (<Text strong>ETB {reinvestUsed.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>, no tax){reinvestNum > reinvestUsed ? ` — unused ETB ${(reinvestNum - reinvestUsed).toFixed(2)} stays in dividend` : ''}</div>
            {additionalNum > 0 && (
              <div>From additional ({f.getFieldValue('additional_payment_method') || 'cash'}): <Text strong>{additionalShares.toLocaleString()}</Text> share{additionalShares === 1 ? '' : 's'} (<Text strong>ETB {additionalUsed.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>){additionalNum > additionalUsed ? ` — unused ETB ${(additionalNum - additionalUsed).toFixed(2)}` : ''}</div>
            )}
            {totalResidual > 0.005 && (
              <div style={{ marginTop: 6 }}>
                <Text type="warning" strong>ETB {totalResidual.toFixed(2)} unused</Text> — doesn't add up to a full share at par ETB {parValue.toLocaleString()}.
                {' '}To buy one more share, add <Text strong>ETB {nextShareNeed.toFixed(2)}</Text> to the additional amount.
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              <Text type="secondary">Tax recalculated on (gross − reinvested). Reinvesting more shares lowers your tax. Investments created at "pending approval".</Text>
            </div>
          </div>
        }
      />
    );
  };

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Dividend Payments</Title>
        <Space>
          <Button
            icon={<FileExcelOutlined />}
            onClick={() => {
              setExportCols(DEFAULT_EXPORT_COLS);
              setExportScope('current');
              setExportShareholders([]);
              setShSearchOptions([]);
              setExportModal(true);
            }}
            style={{ color: '#217346', borderColor: '#217346' }}
          >
            Export Excel
          </Button>
          <Input placeholder="Filter by fiscal year" style={{ width: 200 }}
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)} allowClear
            disabled={!!activeFilters} />
          <Button
            icon={<FilterOutlined />}
            type={advancedOpen ? 'primary' : 'default'}
            onClick={() => setAdvancedOpen(o => !o)}
          >
            {advancedOpen ? 'Hide Advanced Search' : 'Advanced Search'}
          </Button>
          {activeFilters && (
            <Tag color="blue" closable onClose={resetAdvancedSearch}>
              {activeFilters.length} filter{activeFilters.length === 1 ? '' : 's'} applied
            </Tag>
          )}
        </Space>
      </Row>

      <AdvancedSearchPanel
        fields={DIVIDEND_FIELDS}
        open={advancedOpen}
        onSearch={runAdvancedSearch}
        onReset={resetAdvancedSearch}
      />

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }} scroll={{ x: 1500 }}
        expandable={{
          expandedRowRender,
          onExpand: (expanded, record) => { if (expanded) loadExpanded(record.id); },
        }}
      />

      {/* Subscribe / Reinvest modal */}
      <Modal
        title={<><RiseOutlined /> Reinvest / Subscribe from Dividend</>}
        open={!!subscribeModal}
        onCancel={() => setSubscribeModal(null)}
        footer={null}
        width={720}
        destroyOnClose
      >
        {subscribeModal && (
          <>
            <Card size="small" style={{ marginBottom: 12 }}>
              <Row gutter={16}>
                <Col span={6}><Statistic title="Gross" value={subscribeModal.gross_dividend} prefix="ETB" precision={2} /></Col>
                <Col span={6}><Statistic title="Already Reinvested" value={subscribeModal.reinvested_amount || 0} prefix="ETB" precision={2} valueStyle={{ color: '#1677ff' }} /></Col>
                <Col span={6}><Statistic title="Already Collected" value={subscribeModal.collected_amount} prefix="ETB" precision={2} /></Col>
                <Col span={6}><Statistic title="Current Tax" value={subscribeModal.tax_amount} prefix="ETB" precision={2} valueStyle={{ color: '#cf1322' }} /></Col>
              </Row>
            </Card>
            <Form form={subscribeForm} layout="vertical" onFinish={handleSubscribe}>
              <Form.Item
                name="reinvest_amount"
                label="Amount to Reinvest from Dividend"
                tooltip="This portion is removed from the taxable gross. No dividend tax applies to it."
                rules={[{ type: 'number', min: 0 }]}
              >
                <InputNumber style={{ width: '100%' }} min={0} max={subscribeModal.gross_dividend - (subscribeModal.reinvested_amount || 0) - (subscribeModal.collected_amount || 0)} />
              </Form.Item>

              {/* Apply-to-allocations distribution — pays down EXISTING unpaid
                  shares instead of creating a new allocation. Auto-filled
                  greedily on modal open; the operator can adjust per row. */}
              <Divider orientation="left" style={{ margin: '8px 0', fontSize: 13 }}>
                Apply to existing allocations (no new allocation will be created)
              </Divider>
              {subAllocLoading ? (
                <Text type="secondary">Loading allocations…</Text>
              ) : subAllocations.length === 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message="No unpaid allocations to apply this reinvestment to"
                  description="This shareholder has no approved allocations with remaining unpaid shares. Create or approve an allocation first."
                />
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Auto-filled greedily from the oldest allocation. Edit any cell to override. Sum must equal the total funding amount (reinvest + additional).
                    </Text>
                    <Button size="small" type="link" onClick={() => autoDistribute(
                      subAllocations,
                      Number(subscribeForm.getFieldValue('reinvest_amount') || 0),
                      parValue,
                      Number(subscribeForm.getFieldValue('additional_amount') || 0),
                    )}>
                      Auto-fill from amount
                    </Button>
                  </div>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={subAllocations}
                    columns={[
                      { title: 'Allocation', dataIndex: 'allocation_no', width: 130 },
                      { title: 'Rnd', dataIndex: 'round', width: 50 },
                      { title: 'Allocated', dataIndex: 'allocated_shares', width: 90,
                        render: v => formatNumber(v) },
                      { title: 'Paid', dataIndex: 'paid_shares', width: 80,
                        render: v => <Text style={{ color: '#3f8600' }}>{formatNumber(v || 0)}</Text> },
                      { title: 'Pending', dataIndex: 'pending_shares', width: 80,
                        render: v => v ? <Text style={{ color: '#fa8c16' }}>{formatNumber(v)}</Text> : '—' },
                      { title: 'Unpaid', key: 'unpaid', width: 80,
                        render: (_, r) => {
                          const u = Math.max(0, (r.allocated_shares || 0) - (r.paid_shares || 0) - (r.pending_shares || 0));
                          return <Text style={{ color: '#cf1322' }}>{formatNumber(u)}</Text>;
                        }},
                      { title: 'Apply', key: 'apply', width: 110,
                        render: (_, r) => {
                          const cap = Math.max(0, (r.allocated_shares || 0) - (r.paid_shares || 0) - (r.pending_shares || 0));
                          return (
                            <InputNumber
                              size="small"
                              min={0}
                              max={cap}
                              precision={0}
                              value={subDist[r.id] || 0}
                              onChange={(v) => setSubDist(prev => ({ ...prev, [r.id]: Math.min(Number(v) || 0, cap) }))}
                              style={{ width: '100%' }}
                            />
                          );
                        }},
                    ]}
                    summary={() => {
                      const totalShares = Object.values(subDist).reduce((s, v) => s + (Number(v) || 0), 0);
                      const totalAmount = totalShares * (parValue || 0);
                      return (
                        <Table.Summary.Row style={{ background: '#fafafa' }}>
                          <Table.Summary.Cell index={0} colSpan={5}>
                            <Text strong>Total to apply</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={5}>
                            <Text strong>{formatNumber(totalShares)} shares</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={6}>
                            <Text strong style={{ color: '#1677ff' }}>{formatCurrency(totalAmount)}</Text>
                          </Table.Summary.Cell>
                        </Table.Summary.Row>
                      );
                    }}
                  />
                </>
              )}

              <Divider style={{ margin: '8px 0' }}>Optional: add fresh money</Divider>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="additional_amount" label="Additional Amount" tooltip="Money the shareholder is adding from their own pocket — combined with the reinvested portion into one investment.">
                    <InputNumber style={{ width: '100%' }} min={0} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="additional_payment_method" label="Payment Method">
                    <Select options={paymentMethods.filter(p => p.value !== 'dividend')} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="from_account" label="From Account / Reference">
                    <Input placeholder="Bank account, CPO number..." />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="reference_no" label="Bank Reference No">
                    <Input placeholder="Slip / receipt no..." />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="remark" label="Note">
                <Input.TextArea rows={2} />
              </Form.Item>

              <SubscribePreview dividend={subscribeModal} form={subscribeForm} parValue={parValue} />

              <Form.Item style={{ textAlign: 'right', marginBottom: 0, marginTop: 12 }}>
                <Space>
                  <Button onClick={() => setSubscribeModal(null)}>Cancel</Button>
                  <Button type="primary" htmlType="submit" icon={<RiseOutlined />}>Reinvest</Button>
                </Space>
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      <Modal title="Collect Dividend" open={!!collectModal} onCancel={() => setCollectModal(null)} footer={null}>
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={12}><Statistic title="Uncollected" value={collectModal?.uncollected_amount || 0} prefix="ETB" precision={2} /></Col>
            <Col span={12}><Statistic title="Already Collected" value={collectModal?.collected_amount || 0} prefix="ETB" precision={2} /></Col>
          </Row>
        </Card>
        <Form form={form} layout="vertical" onFinish={handleCollect}>
          <Form.Item name="amount" label="Amount to Collect" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} max={collectModal?.uncollected_amount} />
          </Form.Item>
          <Form.Item name="payment_method" label="Payment Method" rules={[{ required: true }]}>
            <Select options={paymentMethods.filter(p => p.value !== 'dividend')} />
          </Form.Item>
          <Form.Item name="remark" label="Remark">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setCollectModal(null)}>Cancel</Button>
              <Button type="primary" htmlType="submit"
                loading={collectSubmitting} disabled={collectSubmitting}>
                Collect
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Transfer Dividend" open={!!transferModal} onCancel={() => setTransferModal(null)} footer={null}>
        <Form form={transferForm} layout="vertical" onFinish={handleTransfer}>
          <Form.Item name="transfer_to" label="Transfer To" rules={[{ required: true }]}>
            <Input placeholder="Name of recipient" />
          </Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
            <Select options={[
              { value: 'inheritance', label: 'Inheritance' },
              { value: 'legal_order', label: 'Legal Order' },
            ]} />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setTransferModal(null)}>Cancel</Button>
              <Button type="primary" htmlType="submit"
                loading={transferSubmitting} disabled={transferSubmitting}>
                Send for Approval
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Excel Export Modal — column picker + scope (current page vs all pages) */}
      <Modal
        open={exportModal}
        onCancel={() => setExportModal(false)}
        title={<Space><FileExcelOutlined style={{ color: '#217346' }} /> Export Dividends to Excel</Space>}
        width={680}
        footer={
          <Space>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 'auto' }}>
              {exportCols.length} of {EXPORT_COLUMNS.length} columns ·{' '}
              {exportScope === 'current'
                ? `${data.length} row${data.length === 1 ? '' : 's'} (current page)`
                : `${total.toLocaleString()} row${total === 1 ? '' : 's'} (all pages)`}
              {exportShareholders.length > 0 && (
                <> · filtered to <Text strong>{exportShareholders.length}</Text> shareholder{exportShareholders.length === 1 ? '' : 's'}</>
              )}
            </Text>
            <Button onClick={() => setExportModal(false)}>Cancel</Button>
            <Button
              type="primary"
              icon={<FileExcelOutlined />}
              loading={exportLoading}
              disabled={exportCols.length === 0}
              onClick={handleExport}
              style={{ background: '#217346', borderColor: '#217346' }}
            >
              Export {exportScope === 'current' ? 'This Page' : 'All Pages'}
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Pick the columns and how much data to include"
          description={
            fiscalYear
              ? `Current filter: fiscal year "${fiscalYear}". Exports will only include rows matching this filter.`
              : 'No fiscal-year filter active — exports include every fiscal year.'
          }
        />

        <Divider orientation="left" style={{ margin: '8px 0', fontSize: 13 }}>Scope</Divider>
        <Radio.Group value={exportScope} onChange={(e) => setExportScope(e.target.value)} style={{ marginBottom: 8 }}>
          <Radio value="current">
            Current page only
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              ({data.length} row{data.length === 1 ? '' : 's'} shown now)
            </Text>
          </Radio>
          <Radio value="all" style={{ marginLeft: 16 }}>
            All pages
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              ({total.toLocaleString()} row{total === 1 ? '' : 's'} total)
            </Text>
          </Radio>
        </Radio.Group>

        <Divider orientation="left" style={{ margin: '12px 0 8px', fontSize: 13 }}>
          Shareholder filter
          <Text type="secondary" style={{ fontWeight: 400, fontSize: 11, marginLeft: 8 }}>
            (optional — leave empty to export all)
          </Text>
        </Divider>
        <Select
          mode="multiple"
          labelInValue
          showSearch
          filterOption={false}
          allowClear
          placeholder="Type 2+ characters to search by account no or name…"
          value={exportShareholders}
          onSearch={handleShareholderSearch}
          onChange={(vals) => setExportShareholders(vals || [])}
          loading={shSearchLoading}
          options={shSearchOptions}
          notFoundContent={
            shSearchLoading
              ? 'Searching…'
              : (shSearchOptions.length === 0 ? 'Type 2+ characters to search' : null)
          }
          style={{ width: '100%' }}
          maxTagCount="responsive"
        />
        {exportShareholders.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#666' }}>
            Only rows for these {exportShareholders.length} shareholder{exportShareholders.length === 1 ? '' : 's'} will be exported. Leave the field empty to include everyone in the chosen scope.
          </div>
        )}

        <Divider orientation="left" style={{ margin: '12px 0 8px', fontSize: 13 }}>Columns</Divider>
        <div style={{ marginBottom: 8 }}>
          <Space size={4}>
            <Button size="small" type="link" onClick={() => setExportCols(ALL_EXPORT_COLS)}>Select all</Button>
            <Button size="small" type="link" onClick={() => setExportCols(DEFAULT_EXPORT_COLS)}>Defaults</Button>
            <Button size="small" type="link" danger onClick={() => setExportCols([])}>Clear</Button>
          </Space>
        </div>

        <div style={{
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          padding: 12,
          maxHeight: 320,
          overflowY: 'auto',
          background: '#fafafa',
        }}>
          <Checkbox.Group
            value={exportCols}
            onChange={setExportCols}
            style={{ width: '100%' }}
          >
            {EXPORT_GROUPS.map(group => {
              const groupCols = EXPORT_COLUMNS.filter(c => c.group === group);
              const groupKeys = groupCols.map(c => c.key);
              const allSelected = groupKeys.every(k => exportCols.includes(k));
              const someSelected = groupKeys.some(k => exportCols.includes(k));
              const toggleGroup = (e) => {
                e.preventDefault();
                if (allSelected) {
                  setExportCols(exportCols.filter(k => !groupKeys.includes(k)));
                } else {
                  setExportCols([...new Set([...exportCols, ...groupKeys])]);
                }
              };
              return (
                <div key={group} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <Text strong style={{ fontSize: 12, color: '#444' }}>{group}</Text>
                    <Button size="small" type="link" onClick={toggleGroup} style={{ fontSize: 11 }}>
                      {allSelected ? 'Clear group' : someSelected ? 'Select rest' : 'Select group'}
                    </Button>
                  </div>
                  <Row gutter={[8, 4]}>
                    {groupCols.map(c => (
                      <Col span={12} key={c.key}>
                        <Checkbox value={c.key} style={{ fontSize: 12 }}>{c.label}</Checkbox>
                      </Col>
                    ))}
                  </Row>
                </div>
              );
            })}
          </Checkbox.Group>
        </div>
      </Modal>
    </div>
  );
}
