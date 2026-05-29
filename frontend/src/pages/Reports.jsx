import { useState, useCallback, useEffect } from 'react';
import {
  Table, Button, Card, Select, DatePicker, Space, Tag, Tabs, Switch, Tooltip,
  message, Typography, Row, Col, Descriptions, Statistic, Divider, Empty,
  InputNumber,
} from 'antd';
import {
  DownloadOutlined, SearchOutlined, PrinterOutlined,
  FileExcelOutlined, UserOutlined, BankOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { getReport, getShareholderStatement, searchShareholders, getDividendSettings } from '../services/api';
import { formatCurrency, formatNumber } from '../utils/format';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const reportGroups = [
  {
    label: 'General Reports',
    options: [
      { value: 'age', label: 'Age Report (by min/max age)' },
      { value: 'sex', label: 'By Sex Report (gender breakdown)' },
    ],
  },
  {
    label: 'Shareholder Reports',
    options: [
      { value: 'master-data', label: 'Master Data Report' },
      { value: 'registration-book', label: 'Registration Book' },
      { value: 'top-shareholders', label: 'Top Shareholders' },
      { value: 'influential-shareholders', label: 'Influential Shareholders' },
      { value: 'foreign-shareholders', label: 'Foreign Shareholders' },
      { value: 'staff-shareholders', label: 'Staff Shareholders' },
      { value: 'dormant-shareholders', label: 'Dormant Shareholders' },
    ],
  },
  {
    label: 'Financial Reports',
    options: [
      { value: 'subscriptions', label: 'Subscription Report' },
      { value: 'investments', label: 'Investment Report' },
      { value: 'transfers', label: 'Transfer Report' },
      { value: 'service-charges', label: 'Service Charges' },
      { value: 'daily-schedules', label: 'Daily Schedules & Tickets' },
      { value: 'allocations', label: 'Allocation Register' },
    ],
  },
  {
    label: 'Dividend Reports',
    options: [
      { value: 'dividends', label: 'Dividend Report' },
      { value: 'dividend-tax', label: 'Dividend Tax Report' },
    ],
  },
  {
    label: 'Other Reports',
    options: [
      { value: 'blocks', label: 'Block/Release Report' },
      { value: 'certificates', label: 'Certificate Report' },
    ],
  },
];

// Which reports support which filters
const dateFilterReports = ['investments', 'transfers', 'service-charges', 'daily-schedules'];
const fiscalYearReports = ['dividends', 'dividend-tax'];
const ageFilterReports = ['age'];
const sexFilterReports = ['sex'];

// Shared style for section titles in the on-screen Individual Statement so
// the headings (Investments / Dividends / Transfers / etc.) match the
// printed PDF's "section-title" CSS — same blue, same underline, same size.
const statementSectionTitleStyle = {
  fontSize: 14,
  fontWeight: 700,
  color: '#1a3a5c',
  borderBottom: '1px solid #1a3a5c',
  paddingBottom: 4,
  marginBottom: 8,
};

// Flatten for label lookup
const allReportTypes = reportGroups.flatMap(g => g.options);

export default function Reports() {
  const [reportType, setReportType] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({});
  const [dateRange, setDateRange] = useState(null);
  const [minAge, setMinAge] = useState(18);
  const [maxAge, setMaxAge] = useState(80);
  const [genderFilter, setGenderFilter] = useState(''); // '' = all
  const [fiscalYear, setFiscalYear] = useState('');
  // Fiscal-year options are populated from the real DividendSetting rows
  // — not hardcoded — so the dropdown reflects what actually exists in the
  // database (e.g. "2025/26" instead of an arbitrary "2025/2026").
  const [fiscalYearOptions, setFiscalYearOptions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getDividendSettings().then(res => {
      if (cancelled) return;
      const seen = new Set();
      const opts = [];
      (res.data?.data || []).forEach(s => {
        if (s.fiscal_year && !seen.has(s.fiscal_year)) {
          seen.add(s.fiscal_year);
          opts.push({ value: s.fiscal_year, label: s.fiscal_year });
        }
      });
      setFiscalYearOptions(opts);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [statementId, setStatementId] = useState(null);
  // Default: only approved items appear in the statement (rejected investments,
  // subscriptions, transfers, and allocations are excluded). Admin can flip
  // the toggle to include rejected entries for diagnostic / audit purposes.
  const [includeRejected, setIncludeRejected] = useState(false);
  const [statementSubTab, setStatementSubTab] = useState('statement');

  const filterApproved = (rows) =>
    includeRejected
      ? (rows || [])
      : (rows || []).filter(r => r?.approval_status !== 'rejected');

  // Build the share-certificate register from approved investments.
  // Each investment row becomes one certificate tranche; ceri-no From/To
  // are computed as a running cumulative range per shareholder.
  const buildCertificateRegister = (stmt) => {
    if (!stmt) return { rows: [], total_amount: 0, total_shares: 0 };
    const sh = stmt.shareholder || {};
    const approved = filterApproved(stmt.investments);
    const sorted = [...approved].sort((a, b) => {
      const da = a.payment_date ? dayjs(a.payment_date).valueOf() : 0;
      const db = b.payment_date ? dayjs(b.payment_date).valueOf() : 0;
      return da - db || (a.id || 0) - (b.id || 0);
    });
    const englishName = `${sh.first_name || ''} ${sh.middle_name || ''} ${sh.last_name || ''}`
      .replace(/\s+/g, ' ').trim();
    const amharicName = `${sh.first_name_am || ''} ${sh.middle_name_am || ''} ${sh.last_name_am || ''}`
      .replace(/\s+/g, ' ').trim();
    let cursor = 0;
    const rows = sorted.map(inv => {
      const shares = inv.number_of_shares || 0;
      const fromNo = shares > 0 ? cursor + 1 : null;
      const toNo = shares > 0 ? cursor + shares : null;
      cursor += shares;
      return {
        key: inv.id,
        sh_id: sh.id,
        cert_no: '',          // manual / pending issuance
        pad_no: '',
        issuance_status: inv.approval_status === 'approved' ? 'Issued' : (inv.approval_status || ''),
        from_no: fromNo,
        to_no: toNo,
        amharic_date: '',
        date_of_registration: inv.payment_date,
        english_name: englishName,
        amharic_name: amharicName,
        share_paid_up: inv.amount || 0,
        share_amount: shares,
      };
    });
    const total_amount = rows.reduce((s, r) => s + (r.share_paid_up || 0), 0);
    const total_shares = rows.reduce((s, r) => s + (r.share_amount || 0), 0);
    return { rows, total_amount, total_shares };
  };

  const [statement, setStatement] = useState(null);
  const [shareholders, setShareholders] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Debounced shareholder search
  const handleSearchSh = useCallback(async (val) => {
    if (!val || val.length < 2) { setShareholders([]); return; }
    setSearchLoading(true);
    try {
      const res = await searchShareholders(val);
      setShareholders((res.data.data || []).map(s => ({
        value: s.id,
        label: `${s.account_no} - ${s.first_name} ${s.middle_name || ''} ${s.last_name}`.replace(/\s+/g, ' '),
      })));
    } catch { /* ignore */ }
    setSearchLoading(false);
  }, []);

  const fetchReport = async () => {
    if (!reportType) { message.warning('Please select a report type'); return; }
    setLoading(true);
    try {
      const params = {};
      if (dateFilterReports.includes(reportType) && dateRange) {
        params.start_date = dateRange[0].format('YYYY-MM-DD');
        params.end_date = dateRange[1].format('YYYY-MM-DD');
      }
      if (fiscalYearReports.includes(reportType) && fiscalYear) {
        params.fiscal_year = fiscalYear;
      }
      if (ageFilterReports.includes(reportType)) {
        params.min_age = minAge ?? 0;
        params.max_age = maxAge ?? 150;
      }
      if (sexFilterReports.includes(reportType) && genderFilter) {
        params.gender = genderFilter;
      }
      const res = await getReport(reportType, params);
      const resultData = res.data.data || [];
      setData(resultData);
      setSummary(res.data);
      if (resultData.length === 0) {
        message.info('No records found for the selected criteria');
      }
    } catch { message.error('Failed to load report'); }
    setLoading(false);
  };

  const fetchStatement = async () => {
    if (!statementId) { message.warning('Please select a shareholder'); return; }
    setLoading(true);
    try {
      const res = await getShareholderStatement(statementId);
      setStatement(res.data);
    } catch { message.error('Failed to load statement'); }
    setLoading(false);
  };

  // Excel export
  const exportToExcel = () => {
    if (!data.length) { message.warning('No data to export'); return; }
    const cols = getColumns();
    const headers = cols.map(c => c.title);
    const rows = data.map(row =>
      cols.map(col => {
        if (col.dataIndex) {
          const val = row[col.dataIndex];
          // Format currency/number fields for Excel (raw numbers, no ETB prefix)
          if (typeof val === 'number') return val;
          if (val instanceof Date) return dayjs(val).format('YYYY-MM-DD');
          return val ?? '';
        }
        if (col.key === 'name') return `${row.first_name || ''} ${row.middle_name || ''} ${row.last_name || ''}`.replace(/\s+/g, ' ');
        if (col.key === 'sh') return row.shareholder ? `${row.shareholder.first_name} ${row.shareholder.last_name}` : '';
        if (col.key === 'from') return row.transferor ? `${row.transferor.first_name} ${row.transferor.last_name}` : '';
        if (col.key === 'to') return row.transferee ? `${row.transferee.first_name} ${row.transferee.last_name}` : '';
        if (col.key === 'released') return row.is_released ? 'Yes' : 'No';
        if (col.key === 'p') return row.is_printed ? 'Yes' : 'No';
        if (col.key === 'status') return row.status;
        if (col.key === 'lines') return (row.lines || []).map(l => l.from_allocation?.allocation_no || '').filter(Boolean).join(', ') || '-';
        if (col.key === 'alloc') return row.allocation ? row.allocation.allocation_no : '-';
        if (col.key === 'bs') {
          const p = row.paid_shares_to_block || 0;
          const u = row.unpaid_shares_to_block || 0;
          return (p > 0 || u > 0) ? `${p} paid / ${u} unpaid` : `${row.block_shares} total`;
        }
        if (col.key === 'paid') return (row.lines || []).reduce((s, l) => s + (l.paid_shares_to_transfer || 0), 0);
        if (col.key === 'unpaid') return (row.lines || []).reduce((s, l) => s + (l.unpaid_shares_to_transfer || 0), 0);
        return '';
      })
    );

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // Auto-width columns
    ws['!cols'] = headers.map((h, i) => ({
      wch: Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)) + 2,
    }));
    const wb = XLSX.utils.book_new();
    const label = allReportTypes.find(r => r.value === reportType)?.label || 'Report';
    XLSX.utils.book_append_sheet(wb, ws, label.substring(0, 31));
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${reportType}-${dayjs().format('YYYY-MM-DD')}.xlsx`);
    message.success('Excel file exported');
  };

  const exportCertificateRegisterToExcel = () => {
    if (!statement) return;
    const sh = statement.shareholder;
    const reg = buildCertificateRegister(statement);
    const headers = [
      'SH-ID', 'Certificate No.', 'Pad No', 'Issuance Status',
      'ceri-no From', 'ceri-no To', 'Amharic Date of Registration',
      'Date of Registration', 'Name of the Shareholder',
      'Amharic Name of the Shareholder', 'Share Paid-up', 'Share Amount',
    ];
    const dataRows = reg.rows.map(r => [
      r.sh_id, r.cert_no, r.pad_no, r.issuance_status,
      r.from_no, r.to_no, r.amharic_date,
      r.date_of_registration ? dayjs(r.date_of_registration).format('D-MMM-YY') : '',
      r.english_name, r.amharic_name, r.share_paid_up, r.share_amount,
    ]);
    const totalRow = [
      '', '', `Total Paid up As of ${dayjs().format('MMM DD/YYYY')}`, '',
      '', '', '', '', '', '', reg.total_amount, reg.total_shares,
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      [`ZEMEN BANK S.C. - Share Certificate Register`],
      [`Shareholder: ${sh?.first_name || ''} ${sh?.middle_name || ''} ${sh?.last_name || ''}`],
      [`Account No: ${sh?.account_no || ''}`],
      [],
      headers, ...dataRows, totalRow,
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Certificate Register');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }),
      `certificate-register-${sh?.account_no}-${dayjs().format('YYYY-MM-DD')}.xlsx`);
    message.success('Certificate register exported');
  };

  const exportStatementToExcel = () => {
    if (!statement) return;
    if (statementSubTab === 'certificate') {
      exportCertificateRegisterToExcel();
      return;
    }
    const wb = XLSX.utils.book_new();
    const sh = statement.shareholder;
    const exportInvestments = filterApproved(statement.investments);
    const exportSubscriptions = filterApproved(statement.subscriptions);
    const exportAllocations = filterApproved(statement.allocations);
    const exportTransfers = filterApproved(statement.transfers);
    // Summary sheet. Total Shares = allocated holding (paid + unpaid) so it
    // reconciles with the Paid/Unpaid rows. Computed from the allocations
    // array so it doesn't depend on backend rollup fields.
    const exHasAllocs = (statement.allocations?.length || 0) > 0;
    const exAllocs = statement.allocations || [];
    const exHolding = exHasAllocs
      ? exAllocs.reduce((s, a) => s + (a.allocated_shares || 0), 0)
      : (statement.total_shares ?? 0);
    const summaryData = [
      ['ZEMEN BANK S.C. - Shareholder Statement'],
      [],
      ['Account No', sh?.account_no],
      ['Name', `${sh?.first_name} ${sh?.middle_name || ''} ${sh?.last_name}`],
      ['Type', sh?.shareholder_type],
      ['Phone', sh?.phone],
      ['Total Shares (holding)', exHolding],
      ['Total Invested', statement.total_invested],
      ...(exHasAllocs ? [
        ['Paid Shares', exAllocs.reduce((s, a) => s + (a.paid_shares || 0), 0)],
        ['Unpaid Shares', exAllocs.reduce((s, a) => s + (a.unpaid_shares || 0), 0)],
        ['Total Blocked', exAllocs.reduce((s, a) => s + (a.blocked_shares || 0), 0)],
      ] : []),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

    // Investments sheet
    if (exportInvestments.length) {
      const invHeaders = ['Date', 'Amount', 'Shares', 'Method', 'Reference', 'Status'];
      const invRows = exportInvestments.map(i => [
        i.payment_date ? dayjs(i.payment_date).format('YYYY-MM-DD') : '',
        i.amount, i.number_of_shares, i.payment_method, i.reference_no, i.status,
      ]);
      const ws2 = XLSX.utils.aoa_to_sheet([invHeaders, ...invRows]);
      XLSX.utils.book_append_sheet(wb, ws2, 'Investments');
    }

    // Dividends sheet
    if (statement.dividends?.length) {
      const divHeaders = ['Fiscal Year', 'Gross', 'Tax', 'Net', 'Collected', 'Uncollected', 'Status'];
      const divRows = statement.dividends.map(d => [
        d.fiscal_year, d.gross_dividend, d.tax_amount, d.net_dividend,
        d.collected_amount, d.uncollected_amount, d.status,
      ]);
      const ws3 = XLSX.utils.aoa_to_sheet([divHeaders, ...divRows]);
      XLSX.utils.book_append_sheet(wb, ws3, 'Dividends');
    }

    // Allocations sheet
    if (exportAllocations.length) {
      const alHeaders = ['Alloc No', 'Round', 'Sub Type', 'Allocated', 'Paid', 'Unpaid', 'Paid Blocked', 'Unpaid Blocked', 'Available', 'Approval'];
      const alRows = exportAllocations.map(a => [
        a.allocation_no, a.round, a.subscription_type,
        a.allocated_shares, a.paid_shares, a.unpaid_shares,
        a.paid_blocked, a.unpaid_blocked, a.available_shares, a.approval_status,
      ]);
      const wsA = XLSX.utils.aoa_to_sheet([alHeaders, ...alRows]);
      XLSX.utils.book_append_sheet(wb, wsA, 'Allocations');
    }

    // Transfers sheet
    if (exportTransfers.length) {
      const trHeaders = ['Batch', 'Date', 'Total Shares', 'Paid', 'Unpaid', 'Amount', 'Type', 'Status', 'From Allocation(s)'];
      const trRows = exportTransfers.map(t => {
        const paidTot = (t.lines || []).reduce((s, l) => s + (l.paid_shares_to_transfer || 0), 0);
        const unpaidTot = (t.lines || []).reduce((s, l) => s + (l.unpaid_shares_to_transfer || 0), 0);
        const fromAllocs = (t.lines || []).map(l => l.from_allocation?.allocation_no || l.from_allocation_id || '').filter(Boolean).join(', ');
        return [t.batch_no, t.transfer_date ? dayjs(t.transfer_date).format('YYYY-MM-DD') : '',
          t.number_of_shares, paidTot, unpaidTot, t.transfer_amount, t.transfer_type, t.status, fromAllocs];
      });
      const ws4 = XLSX.utils.aoa_to_sheet([trHeaders, ...trRows]);
      XLSX.utils.book_append_sheet(wb, ws4, 'Transfers');
    }

    // Blocks sheet
    if (statement.blocks?.length) {
      const blHeaders = ['Allocation', 'Block Type', 'Shares Type', 'Total Blocked', 'Paid Blocked', 'Unpaid Blocked', 'Amount', 'Reason', 'Released'];
      const blRows = statement.blocks.map(b => {
        const p = b.paid_shares_to_block || 0;
        const u = b.unpaid_shares_to_block || 0;
        return [
          b.allocation?.allocation_no || '-', b.block_type, b.shares_type || '-',
          b.block_shares, (p > 0 || u > 0) ? p : b.block_shares, (p > 0 || u > 0) ? u : 0,
          b.block_amount_birr, b.reason, b.is_released ? 'Yes' : 'No',
        ];
      });
      const ws5 = XLSX.utils.aoa_to_sheet([blHeaders, ...blRows]);
      XLSX.utils.book_append_sheet(wb, ws5, 'Blocks');
    }

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }),
      `statement-${sh?.account_no}-${dayjs().format('YYYY-MM-DD')}.xlsx`);
    message.success('Statement exported');
  };

  // Print report
  const handlePrintCertificateRegister = () => {
    if (!statement) return;
    const sh = statement.shareholder;
    const reg = buildCertificateRegister(statement);
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Share Certificate Register</title>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; margin: 18px; color: #333; }
      .header { text-align: center; border-bottom: 3px double #1a3a5c; padding-bottom: 12px; margin-bottom: 16px; }
      .header h1 { color: #1a3a5c; margin: 0; font-size: 22px; }
      .header h2 { color: #1a3a5c; margin: 2px 0; font-size: 14px; font-weight: normal; }
      .header h3 { color: #333; margin: 8px 0 0; font-size: 16px; }
      .meta { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 11px; color: #666; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      th { background: #f5a06b; color: #000; padding: 8px 5px; text-align: center; border: 1px solid #999; font-weight: bold; }
      td { padding: 5px 4px; border: 1px solid #ccc; }
      td.num { text-align: right; }
      td.center { text-align: center; }
      tr.total { background: #d9d9d9; font-weight: bold; }
      .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #999; border-top: 1px solid #ddd; padding-top: 8px; }
      @media print { body { margin: 8px; } @page { size: A4 landscape; } }
    </style></head><body>
      <div class="header">
        <h1>ZEMEN BANK S.C.</h1>
        <h2>&#x12D8;&#x1218;&#x1295; &#x1263;&#x1295;&#x12AD; &#x12A0;.&#x121B;.</h2>
        <h3>Share Certificate Register</h3>
      </div>
      <div class="meta">
        <span>Account No: <b>${sh?.account_no || '—'}</b> &nbsp;&nbsp; Name: <b>${sh?.first_name || ''} ${sh?.middle_name || ''} ${sh?.last_name || ''}</b></span>
        <span>Generated: ${dayjs().format('MMMM D, YYYY h:mm A')}</span>
      </div>
      <table>
        <thead><tr>
          <th>SH-ID</th><th>Certificate No.</th><th>Pad No</th><th>Issuance Status</th>
          <th>ceri-no From</th><th>ceri-no To</th><th>Amharic Date of Registration</th>
          <th>Data of Registration</th><th>Name of the Shareholder</th>
          <th>Amharic Name of the Shareholder</th><th>Share Paid-up</th><th>Share Amount</th>
        </tr></thead>
        <tbody>`);
    reg.rows.forEach(r => {
      printWindow.document.write(`<tr>
        <td class="center">${r.sh_id || ''}</td>
        <td>${r.cert_no || ''}</td>
        <td>${r.pad_no || ''}</td>
        <td class="center">${r.issuance_status || ''}</td>
        <td class="num">${r.from_no ? formatNumber(r.from_no) : ''}</td>
        <td class="num">${r.to_no ? formatNumber(r.to_no) : ''}</td>
        <td>${r.amharic_date || ''}</td>
        <td>${r.date_of_registration ? dayjs(r.date_of_registration).format('D-MMM-YY') : ''}</td>
        <td>${r.english_name || ''}</td>
        <td>${r.amharic_name || ''}</td>
        <td class="num">${formatCurrency(r.share_paid_up)}</td>
        <td class="num">${formatNumber(r.share_amount)}</td>
      </tr>`);
    });
    printWindow.document.write(`
        <tr class="total">
          <td colspan="3" class="center">Total Paid up As of ${dayjs().format('MMM DD/YYYY')}</td>
          <td colspan="7"></td>
          <td class="num">${formatCurrency(reg.total_amount)}</td>
          <td class="num">${formatNumber(reg.total_shares)}</td>
        </tr>
        </tbody></table>
        <div class="footer">System-generated. Certificate No, Pad No, ceri-no ranges, and Amharic dates may be edited by the secretariat after issuance.</div>
        <script>window.onload = () => { window.print(); }</script>
      </body></html>`);
    printWindow.document.close();
  };

  const handlePrint = () => {
    if (statement && statementSubTab === 'certificate') {
      handlePrintCertificateRegister();
      return;
    }
    if (!data.length && !statement) { message.warning('No data to print'); return; }
    const cols = statement ? null : getColumns();
    const label = allReportTypes.find(r => r.value === reportType)?.label || 'Report';

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!DOCTYPE html><html><head><title>${statement ? 'Shareholder Statement' : label}</title>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; margin: 20px; color: #333; }
      .header { text-align: center; border-bottom: 3px double #1a3a5c; padding-bottom: 15px; margin-bottom: 20px; }
      .header h1 { color: #1a3a5c; margin: 0; font-size: 22px; }
      .header h2 { color: #1a3a5c; margin: 2px 0; font-size: 14px; font-weight: normal; }
      .header h3 { color: #333; margin: 10px 0 0; font-size: 16px; }
      .meta { display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 12px; color: #666; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { background: #1a3a5c; color: white; padding: 8px 6px; text-align: left; }
      td { padding: 6px; border-bottom: 1px solid #ddd; }
      tr:nth-child(even) { background: #f8f9fa; }
      .summary-box { background: #f0f5ff; border: 1px solid #adc6ff; padding: 12px; margin-bottom: 15px; border-radius: 4px; }
      .summary-box .item { display: inline-block; margin-right: 30px; }
      .summary-box .label { font-size: 11px; color: #666; }
      .summary-box .value { font-size: 14px; font-weight: bold; color: #1a3a5c; }
      .section-title { font-size: 14px; font-weight: bold; margin: 20px 0 8px; color: #1a3a5c; border-bottom: 1px solid #1a3a5c; padding-bottom: 4px; }
      .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #999; border-top: 1px solid #ddd; padding-top: 10px; }
      @media print { body { margin: 10px; } .no-print { display: none; } }
    </style></head><body>`);

    // Header
    printWindow.document.write(`
      <div class="header">
        <h1>ZEMEN BANK S.C.</h1>
        <h2>&#x12D8;&#x1218;&#x1295; &#x1263;&#x1295;&#x12AD; &#x12A0;.&#x121B;.</h2>
        <h3>${statement ? 'Shareholder Statement' : label}</h3>
      </div>
      <div class="meta">
        <span>Generated: ${dayjs().format('MMMM D, YYYY h:mm A')}</span>
        ${fiscalYear ? `<span>Fiscal Year: ${fiscalYear}</span>` : ''}
        ${dateRange ? `<span>Period: ${dateRange[0].format('YYYY-MM-DD')} to ${dateRange[1].format('YYYY-MM-DD')}</span>` : ''}
      </div>
    `);

    if (statement) {
      // Print individual statement
      const sh = statement.shareholder;
      const printInvestments = filterApproved(statement.investments);
      const printSubscriptions = filterApproved(statement.subscriptions);
      const printAllocations = filterApproved(statement.allocations);
      const printTransfers = filterApproved(statement.transfers);
      printWindow.document.write(`
        <div class="summary-box">
          <div class="item"><div class="label">Account No</div><div class="value">${sh?.account_no || '-'}</div></div>
          <div class="item"><div class="label">Name</div><div class="value">${sh?.first_name} ${sh?.middle_name || ''} ${sh?.last_name}</div></div>
          <div class="item"><div class="label">Type</div><div class="value">${sh?.shareholder_type || '-'}</div></div>
          ${printAllocations.length > 0 ? (() => {
            const holding = printAllocations.reduce((s, a) => s + (a.allocated_shares || 0), 0);
            const tp = printAllocations.reduce((s, a) => s + (a.paid_shares || 0), 0);
            const tu = printAllocations.reduce((s, a) => s + (a.unpaid_shares || 0), 0);
            const tb = printAllocations.reduce((s, a) => s + (a.blocked_shares || 0), 0);
            return `<div class="item"><div class="label">Total Shares (holding)</div><div class="value">${formatNumber(holding)}</div></div>
            <div class="item"><div class="label">Total Invested</div><div class="value">${formatCurrency(statement.total_invested)}</div></div>
            <div class="item"><div class="label">Paid Shares</div><div class="value">${formatNumber(tp)}</div></div>
            <div class="item"><div class="label">Unpaid Shares</div><div class="value">${formatNumber(tu)}</div></div>
            <div class="item"><div class="label">Total Blocked</div><div class="value">${formatNumber(tb)}</div></div>`;
          })() : `<div class="item"><div class="label">Total Shares</div><div class="value">${formatNumber(statement.total_shares)}</div></div>
            <div class="item"><div class="label">Total Invested</div><div class="value">${formatCurrency(statement.total_invested)}</div></div>`}
          ${!includeRejected ? '<div class="item" style="color:#999;font-size:10px;"><em>Approved entries only</em></div>' : '<div class="item" style="color:#cf1322;font-size:10px;"><em>Including rejected</em></div>'}
        </div>
      `);

      // Investments table
      if (printInvestments.length) {
        printWindow.document.write(`<div class="section-title">Investments (${printInvestments.length})</div><table><tr><th>Date</th><th>Amount</th><th>Shares</th><th>Method</th><th>Reference</th></tr>`);
        printInvestments.forEach(i => {
          printWindow.document.write(`<tr><td>${i.payment_date ? dayjs(i.payment_date).format('YYYY-MM-DD') : '-'}</td><td>${formatCurrency(i.amount)}</td><td>${i.number_of_shares}</td><td>${i.payment_method}</td><td>${i.reference_no || '-'}</td></tr>`);
        });
        printWindow.document.write('</table>');
      }

      // Dividends table
      if (statement.dividends?.length) {
        printWindow.document.write(`<div class="section-title">Dividends (${statement.dividends.length})</div><table><tr><th>Fiscal Year</th><th>Gross</th><th>Tax</th><th>Net</th><th>Collected</th><th>Status</th></tr>`);
        statement.dividends.forEach(d => {
          printWindow.document.write(`<tr><td>${d.fiscal_year}</td><td>${formatCurrency(d.gross_dividend)}</td><td>${formatCurrency(d.tax_amount)}</td><td>${formatCurrency(d.net_dividend)}</td><td>${formatCurrency(d.collected_amount)}</td><td>${d.status}</td></tr>`);
        });
        printWindow.document.write('</table>');
      }

      // Allocations table
      if (printAllocations.length) {
        printWindow.document.write(`<div class="section-title">Allocations (${printAllocations.length})</div><table><tr><th>Alloc No</th><th>Round</th><th>Type</th><th>Allocated</th><th>Paid</th><th>Unpaid</th><th>Paid Blocked</th><th>Unpaid Blocked</th><th>Available</th><th>Approval</th></tr>`);
        printAllocations.forEach(a => {
          printWindow.document.write(`<tr><td>${a.allocation_no}</td><td>${a.round || '-'}</td><td>${a.subscription_type || '-'}</td><td>${formatNumber(a.allocated_shares)}</td><td>${formatNumber(a.paid_shares)}</td><td>${formatNumber(a.unpaid_shares)}</td><td>${a.paid_blocked || 0}</td><td>${a.unpaid_blocked || 0}</td><td>${formatNumber(a.available_shares)}</td><td>${a.approval_status}</td></tr>`);
        });
        printWindow.document.write('</table>');
      }

      // Transfers table
      if (printTransfers.length) {
        printWindow.document.write(`<div class="section-title">Transfers (${printTransfers.length})</div><table><tr><th>Batch</th><th>Date</th><th>Total Shares</th><th>Paid</th><th>Unpaid</th><th>Amount</th><th>Type</th><th>Status</th><th>From Allocation(s)</th></tr>`);
        printTransfers.forEach(t => {
          const paidTot = (t.lines || []).reduce((s, l) => s + (l.paid_shares_to_transfer || 0), 0);
          const unpaidTot = (t.lines || []).reduce((s, l) => s + (l.unpaid_shares_to_transfer || 0), 0);
          const fromAllocs = (t.lines || []).map(l => l.from_allocation?.allocation_no || '').filter(Boolean).join(', ') || '-';
          printWindow.document.write(`<tr><td>${t.batch_no}</td><td>${t.transfer_date ? dayjs(t.transfer_date).format('YYYY-MM-DD') : '-'}</td><td>${t.number_of_shares}</td><td>${paidTot}</td><td>${unpaidTot}</td><td>${formatCurrency(t.transfer_amount)}</td><td>${t.transfer_type}</td><td>${t.status}</td><td>${fromAllocs}</td></tr>`);
        });
        printWindow.document.write('</table>');
      }

      // Blocks table
      if (statement.blocks?.length) {
        printWindow.document.write(`<div class="section-title">Share Blocks (${statement.blocks.length})</div><table><tr><th>Allocation</th><th>Block Type</th><th>Shares Type</th><th>Total Blocked</th><th>Paid Blocked</th><th>Unpaid Blocked</th><th>Amount</th><th>Reason</th><th>Released</th></tr>`);
        statement.blocks.forEach(b => {
          const p = b.paid_shares_to_block || 0;
          const u = b.unpaid_shares_to_block || 0;
          const paidDisp = (p > 0 || u > 0) ? p : b.block_shares;
          const unpaidDisp = (p > 0 || u > 0) ? u : 0;
          printWindow.document.write(`<tr><td>${b.allocation?.allocation_no || '-'}</td><td>${b.block_type}</td><td>${b.shares_type || '-'}</td><td>${b.block_shares}</td><td>${paidDisp}</td><td>${unpaidDisp}</td><td>${formatCurrency(b.block_amount_birr)}</td><td>${b.reason || '-'}</td><td>${b.is_released ? 'Yes' : 'No'}</td></tr>`);
        });
        printWindow.document.write('</table>');
      }
    } else {
      // Print general report
      if (summary.total_amount !== undefined) {
        printWindow.document.write(`<div class="summary-box"><div class="item"><div class="label">Total Records</div><div class="value">${summary.total || data.length}</div></div><div class="item"><div class="label">Total Amount</div><div class="value">${formatCurrency(summary.total_amount)}</div></div></div>`);
      }
      if (summary.total_gross !== undefined) {
        printWindow.document.write(`<div class="summary-box">
          <div class="item"><div class="label">Records</div><div class="value">${summary.total || data.length}</div></div>
          <div class="item"><div class="label">Total Gross</div><div class="value">${formatCurrency(summary.total_gross)}</div></div>
          <div class="item"><div class="label">Total Tax</div><div class="value">${formatCurrency(summary.total_tax)}</div></div>
          <div class="item"><div class="label">Total Net</div><div class="value">${formatCurrency(summary.total_net)}</div></div>
          <div class="item"><div class="label">Total Collected</div><div class="value">${formatCurrency(summary.total_collected)}</div></div>
        </div>`);
      }

      printWindow.document.write('<table><tr>');
      cols.forEach(c => printWindow.document.write(`<th>${c.title}</th>`));
      printWindow.document.write('</tr>');
      data.forEach(row => {
        printWindow.document.write('<tr>');
        cols.forEach(col => {
          let val = '';
          if (col.dataIndex) {
            val = row[col.dataIndex] ?? '';
            if (typeof val === 'number' && (col.dataIndex.includes('amount') || col.dataIndex.includes('invested') || col.dataIndex.includes('dividend') || col.dataIndex.includes('tax') || col.dataIndex.includes('fee') || col.dataIndex.includes('value') || col.dataIndex === 'amount'))
              val = formatCurrency(val);
            else if (col.dataIndex.includes('date') && val) val = dayjs(val).format('YYYY-MM-DD');
          }
          else if (col.key === 'name') val = `${row.first_name || ''} ${row.middle_name || ''} ${row.last_name || ''}`;
          else if (col.key === 'sh') val = row.shareholder ? `${row.shareholder.first_name} ${row.shareholder.last_name}` : '';
          else if (col.key === 'from') val = row.transferor ? `${row.transferor.first_name} ${row.transferor.last_name}` : '';
          else if (col.key === 'to') val = row.transferee ? `${row.transferee.first_name} ${row.transferee.last_name}` : '';
          else if (col.key === 'released') val = row.is_released ? 'Yes' : 'No';
          else if (col.key === 'p') val = row.is_printed ? 'Yes' : 'No';
          else if (col.key === 'status') val = row.status;
          else if (col.key === 'lines') val = (row.lines || []).map(l => l.from_allocation?.allocation_no || l.from_allocation_id || '').filter(Boolean).join(', ') || '-';
          else if (col.key === 'alloc') val = row.allocation ? row.allocation.allocation_no : '-';
          else if (col.key === 'bs') {
            const p = row.paid_shares_to_block || 0;
            const u = row.unpaid_shares_to_block || 0;
            val = (p > 0 || u > 0) ? `${p} paid / ${u} unpaid` : `${row.block_shares} total`;
          }
          else if (col.key === 'paid') val = (row.lines || []).reduce((s, l) => s + (l.paid_shares_to_transfer || 0), 0);
          else if (col.key === 'unpaid') val = (row.lines || []).reduce((s, l) => s + (l.unpaid_shares_to_transfer || 0), 0);
          printWindow.document.write(`<td>${val}</td>`);
        });
        printWindow.document.write('</tr>');
      });
      printWindow.document.write('</table>');
    }

    printWindow.document.write(`<div class="footer">ZEMEN BANK S.C. &mdash; Confidential &mdash; Printed on ${dayjs().format('MMMM D, YYYY')}</div>`);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  const getColumns = () => {
    switch (reportType) {
      case 'master-data':
      case 'staff-shareholders':
      case 'dormant-shareholders':
        return [
          { title: 'Account', dataIndex: 'account_no', width: 100 },
          { title: 'Name', key: 'name', render: (_, r) => `${r.first_name} ${r.middle_name || ''} ${r.last_name}` },
          { title: 'Type', dataIndex: 'shareholder_type' },
          { title: 'Phone', dataIndex: 'phone' },
          { title: 'TIN', dataIndex: 'tin' },
          { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'active' ? 'green' : 'red'}>{s}</Tag> },
        ];
      case 'subscriptions':
        return [
          { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
          { title: 'Shares', dataIndex: 'number_of_shares' },
          { title: 'Amount', dataIndex: 'share_amount', render: (v) => formatCurrency(v) },
          { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'active' ? 'green' : s === 'extended' ? 'blue' : 'red'}>{s}</Tag> },
          { title: 'Expiry', dataIndex: 'expiry_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
        ];
      case 'investments':
        return [
          { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
          { title: 'Date', dataIndex: 'payment_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
          { title: 'Method', dataIndex: 'payment_method' },
          { title: 'Amount', dataIndex: 'amount', render: (v) => formatCurrency(v) },
          { title: 'Shares', dataIndex: 'number_of_shares' },
          { title: 'Reference', dataIndex: 'reference_no' },
        ];
      case 'transfers':
        return [
          { title: 'Batch', dataIndex: 'batch_no', width: 110 },
          { title: 'From', key: 'from', width: 130, render: (_, r) => r.transferor ? `${r.transferor.first_name} ${r.transferor.last_name}` : '-' },
          { title: 'To', key: 'to', width: 130, render: (_, r) => r.transferee ? `${r.transferee.first_name} ${r.transferee.last_name}` : '-' },
          { title: 'Total Shares', dataIndex: 'number_of_shares', width: 90 },
          { title: 'Paid', dataIndex: 'paid_shares_total', width: 80,
            render: (v) => v > 0 ? <Tag color="blue">{v}</Tag> : <Tag color="default">0</Tag> },
          { title: 'Unpaid', dataIndex: 'unpaid_shares_total', width: 80,
            render: (v) => v > 0 ? <Tag color="orange">{v}</Tag> : <Tag color="default">0</Tag> },
          { title: 'From Alloc(s)', key: 'lines', width: 130,
            render: (_, r) => r.lines && r.lines.length
              ? r.lines.map(l => <Tag key={l.id} style={{ fontSize: 10 }}>{l.from_allocation ? l.from_allocation.allocation_no : l.from_allocation_id}</Tag>)
              : '-' },
          { title: 'Amount', dataIndex: 'transfer_amount', render: (v) => formatCurrency(v) },
          { title: 'Fees', dataIndex: 'total_fees', render: (v) => formatCurrency(v) },
          { title: 'Date', dataIndex: 'transfer_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
          { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'approved' ? 'green' : s === 'pending' ? 'orange' : 'red'}>{s}</Tag> },
        ];
      case 'dividends':
        return [
          { title: 'Sh. ID', key: 'shid', width: 70, render: (_, r) => r.shareholder_id ?? r.shareholder?.id ?? '-' },
          { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
          { title: 'Account', key: 'acc', render: (_, r) => r.shareholder?.account_no || '-' },
          { title: 'Fiscal Year', dataIndex: 'fiscal_year' },
          { title: 'Gross', dataIndex: 'gross_dividend', render: (v) => formatCurrency(v) },
          { title: 'Tax', dataIndex: 'tax_amount', render: (v) => formatCurrency(v) },
          { title: 'Net', dataIndex: 'net_dividend', render: (v) => formatCurrency(v) },
          { title: 'Reinvested', dataIndex: 'reinvested_amount', render: (v) => v > 0 ? <Text style={{ color: '#1677ff' }}>{formatCurrency(v)}</Text> : '—' },
          { title: 'Collected (cash)', dataIndex: 'collected_amount', render: (v) => v > 0 ? <Text style={{ color: '#3f8600' }}>{formatCurrency(v)}</Text> : '—' },
          { title: 'Transferred', key: 'transferred', render: (_, r) => r.is_transferred
            ? <Tag color="purple">{formatCurrency(r.net_dividend)} → {r.transfer_to}</Tag>
            : '—' },
          { title: 'Blocked', key: 'blocked', render: (_, r) => r.is_blocked
            ? <Tag color="red">{formatCurrency(r.uncollected_amount)}</Tag>
            : '—' },
          { title: 'Uncollected', dataIndex: 'uncollected_amount', render: (v) => v > 0 ? <Text style={{ color: '#cf1322' }}>{formatCurrency(v)}</Text> : '—' },
          { title: 'Status', key: 'status', render: (_, r) => (
            <Space direction="vertical" size={0}>
              <Tag color={r.status === 'collected' ? 'green' : r.status === 'partial' ? 'blue' : r.status === 'transferred' ? 'purple' : r.status === 'settled' ? 'green' : 'orange'}>{r.status}</Tag>
              {r.is_blocked && <Tag color="red">BLOCKED</Tag>}
            </Space>
          )},
        ];
      case 'dividend-tax':
        return [
          { title: 'Sh. ID', key: 'shid', width: 70, render: (_, r) => r.shareholder_id ?? r.shareholder?.id ?? '-' },
          { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
          { title: 'Fiscal Year', dataIndex: 'fiscal_year' },
          { title: 'Gross Dividend', dataIndex: 'gross_dividend', render: (v) => formatCurrency(v) },
          { title: 'Reinvested (no tax)', dataIndex: 'reinvested_amount', render: v => v > 0 ? <Text style={{ color: '#1677ff' }}>{formatCurrency(v)}</Text> : '—' },
          { title: 'Taxable Gross', key: 'taxable', render: (_, r) => formatCurrency((Number(r.gross_dividend) || 0) - (Number(r.reinvested_amount) || 0)) },
          { title: 'Tax Amount', dataIndex: 'tax_amount', render: (v) => <Text style={{ color: '#cf1322' }}>{formatCurrency(v)}</Text> },
          { title: 'Bracket Rate', key: 'bracket', render: (_, r) => {
            const taxable = (Number(r.gross_dividend) || 0) - (Number(r.reinvested_amount) || 0);
            return taxable > 0 ? `${((Number(r.tax_amount) / taxable) * 100).toFixed(2)}%` : '—';
          } },
          { title: 'Effective Rate', key: 'effective',
            render: (_, r) => {
              if (!r.gross_dividend) return '—';
              const eff = (Number(r.tax_amount) / Number(r.gross_dividend)) * 100;
              const taxable = (Number(r.gross_dividend) || 0) - (Number(r.reinvested_amount) || 0);
              const bracket = taxable > 0 ? (Number(r.tax_amount) / taxable) * 100 : 0;
              const differs = Math.abs(eff - bracket) > 0.05;
              const cell = `${eff.toFixed(2)}%`;
              if (!differs) return cell;
              return <Text type="secondary">{cell}<Text type="secondary" style={{ fontSize: 10, display: 'block' }}>vs gross</Text></Text>;
            }
          },
          { title: 'Net Dividend', dataIndex: 'net_dividend', render: (v) => <Text style={{ color: '#3f8600' }}>{formatCurrency(v)}</Text> },
          { title: 'Collected', dataIndex: 'collected_amount', render: v => v > 0 ? <Text style={{ color: '#3f8600' }}>{formatCurrency(v)}</Text> : '—' },
          { title: 'Uncollected', dataIndex: 'uncollected_amount', render: v => v > 0 ? <Text style={{ color: '#fa8c16' }}>{formatCurrency(v)}</Text> : '—' },
        ];
      case 'top-shareholders':
        return [
          { title: 'Account', dataIndex: 'account_no' },
          { title: 'Name', dataIndex: 'name' },
          { title: 'Total Shares', dataIndex: 'total_shares', render: (v) => formatNumber(v) },
          { title: 'Total Invested', dataIndex: 'total_invested', render: (v) => formatCurrency(v) },
        ];
      case 'sex':
        return [
          { title: 'Account', dataIndex: 'account_no', width: 100 },
          { title: 'Name', key: 'name', render: (_, r) =>
            `${r.first_name || ''} ${r.middle_name || ''} ${r.last_name || ''}`.replace(/\s+/g, ' ').trim() },
          { title: 'Gender', dataIndex: 'gender', width: 110,
            render: (v) => {
              const g = (v || '').toLowerCase().trim();
              const color = g === 'female' ? 'magenta' : g === 'male' ? 'blue' : g === 'other' ? 'purple' : 'default';
              return <Tag color={color}>{v || 'unspecified'}</Tag>;
            } },
          { title: 'Type', dataIndex: 'shareholder_type', width: 110 },
          { title: 'Phone', dataIndex: 'phone', width: 120, render: (v) => v || '—' },
          { title: 'Date of Birth', dataIndex: 'date_of_birth', width: 120,
            render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '—' },
          { title: 'Total Shares', dataIndex: 'total_shares', width: 120, align: 'right',
            render: (v) => formatNumber(v) },
          { title: 'Total Invested', dataIndex: 'total_invested', width: 140, align: 'right',
            render: (v) => formatCurrency(v) },
          { title: 'Status', dataIndex: 'status', width: 90,
            render: (v) => <Tag color={v === 'active' ? 'green' : 'default'}>{v}</Tag> },
        ];
      case 'age':
        return [
          { title: 'Account', dataIndex: 'account_no', width: 100 },
          { title: 'Name', key: 'name', render: (_, r) =>
            `${r.first_name || ''} ${r.middle_name || ''} ${r.last_name || ''}`.replace(/\s+/g, ' ').trim() },
          { title: 'Date of Birth', dataIndex: 'date_of_birth', width: 120,
            render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '—' },
          { title: 'Age', dataIndex: 'age', width: 70, align: 'right',
            sorter: (a, b) => (a.age || 0) - (b.age || 0),
            render: (v) => <Text strong>{v}</Text> },
          { title: 'Gender', dataIndex: 'gender', width: 80,
            render: (v) => v ? <Tag color={v === 'female' ? 'magenta' : v === 'male' ? 'blue' : 'default'}>{v}</Tag> : '—' },
          { title: 'Phone', dataIndex: 'phone', width: 120, render: (v) => v || '—' },
          { title: 'Type', dataIndex: 'shareholder_type', width: 110 },
          { title: 'Total Shares', dataIndex: 'total_shares', width: 120, align: 'right',
            render: (v) => formatNumber(v) },
          { title: 'Total Invested', dataIndex: 'total_invested', width: 140, align: 'right',
            render: (v) => formatCurrency(v) },
          { title: 'Status', dataIndex: 'status', width: 90,
            render: (v) => <Tag color={v === 'active' ? 'green' : 'default'}>{v}</Tag> },
        ];
      case 'foreign-shareholders':
      case 'registration-book':
        return [
          { title: 'Account', dataIndex: 'account_no', width: 100 },
          { title: 'Name', key: 'name', render: (_, r) => `${r.first_name} ${r.middle_name || ''} ${r.last_name}` },
          { title: 'Type', dataIndex: 'shareholder_type' },
          { title: 'Total Shares', dataIndex: 'total_shares', render: (v) => formatNumber(v) },
          { title: 'Total Invested', dataIndex: 'total_invested', render: (v) => formatCurrency(v) },
        ];
      case 'blocks':
        return [
          { title: 'Shareholder', key: 'sh', width: 140, render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
          { title: 'Allocation', key: 'alloc', width: 130,
            render: (_, r) => r.allocation
              ? <Tag color="blue">{r.allocation.allocation_no}</Tag>
              : r.allocation_id
                ? <Tag color="orange">Alloc #{r.allocation_id}</Tag>
                : <Tag color="red">Legacy</Tag> },
          { title: 'Block Type', dataIndex: 'block_type', width: 100 },
          { title: 'Shares Type', dataIndex: 'shares_type', width: 90,
            render: (s) => <Tag color={s === 'paid' ? 'blue' : s === 'unpaid' ? 'orange' : 'purple'}>{s || '-'}</Tag> },
          { title: 'Blocked Shares', key: 'bs', width: 130,
            render: (_, r) => {
              if (r.shares_type === 'both') {
                const p = r.paid_shares_to_block || 0;
                const u = r.unpaid_shares_to_block || 0;
                if (p === 0 && u === 0) return <Tag color="red">{r.block_shares} total</Tag>;
                return <Space size={2}><Tag color="blue">{p} paid</Tag><Tag color="orange">{u} unpaid</Tag></Space>;
              }
              return <Tag color={r.shares_type === 'paid' ? 'blue' : 'orange'}>{r.block_shares}</Tag>;
            }},
          { title: 'Amount (Birr)', dataIndex: 'block_amount_birr', width: 110, render: (v) => formatCurrency(v) },
          { title: 'Reason', dataIndex: 'reason' },
          { title: 'Released', key: 'released', width: 80, render: (_, r) => <Tag color={r.is_released ? 'green' : 'red'}>{r.is_released ? 'Yes' : 'No'}</Tag> },
          { title: 'Status', dataIndex: 'status', width: 80, render: (s) => <Tag color={s === 'released' ? 'green' : s === 'active' ? 'blue' : 'orange'}>{s}</Tag> },
        ];
      case 'certificates':
        return [
          { title: 'Cert No', dataIndex: 'certificate_no', width: 140 },
          { title: 'Shareholder', key: 'sh', width: 150, render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
          { title: 'Scope', dataIndex: 'cert_scope', width: 120,
            render: (s) => <Tag color={s === 'per_allocation' ? 'blue' : 'purple'}>{s === 'per_allocation' ? 'Per Allocation' : 'Total Holdings'}</Tag> },
          { title: 'Allocation', key: 'alloc', width: 110,
            render: (_, r) => r.allocation ? <Tag>{r.allocation.allocation_no}</Tag> : <Tag color="default">All</Tag> },
          { title: 'Shares', dataIndex: 'number_of_shares', width: 80, render: (v) => formatNumber(v) },
          { title: 'Par Value', dataIndex: 'par_value', width: 90, render: (v) => formatCurrency(v) },
          { title: 'Total Value', dataIndex: 'total_value', width: 110, render: (v) => formatCurrency(v) },
          { title: 'Issue Date', dataIndex: 'issue_date', width: 100, render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
          { title: 'Printed', key: 'p', width: 70, render: (_, r) => <Tag color={r.is_printed ? 'green' : 'orange'}>{r.is_printed ? 'Yes' : 'No'}</Tag> },
          { title: 'Status', dataIndex: 'status', width: 80, render: (s) => <Tag color={s === 'active' ? 'green' : 'red'}>{s}</Tag> },
        ];
      case 'service-charges':
        return [
          { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
          { title: 'Type', dataIndex: 'charge_type' },
          { title: 'Amount', dataIndex: 'amount', render: (v) => formatCurrency(v) },
          { title: 'Reference', dataIndex: 'reference_type' },
          { title: 'Date', dataIndex: 'charge_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
        ];
      case 'daily-schedules':
        return [
          { title: 'Date', dataIndex: 'date' },
          { title: 'Investments', dataIndex: 'investments' },
          { title: 'Investment Amt', dataIndex: 'investment_amount', render: (v) => formatCurrency(v) },
          { title: 'Transfers', dataIndex: 'transfers' },
          { title: 'Transfer Amt', dataIndex: 'transfer_amount', render: (v) => formatCurrency(v) },
          { title: 'Collections', dataIndex: 'collections' },
          { title: 'Collection Amt', dataIndex: 'collection_amount', render: (v) => formatCurrency(v) },
          { title: 'Service Fees', dataIndex: 'service_fees', render: (v) => formatCurrency(v) },
        ];
      case 'influential-shareholders':
        return [
          { title: 'Account', dataIndex: 'account_no' },
          { title: 'Name', dataIndex: 'name' },
          { title: 'Type', dataIndex: 'shareholder_type' },
          { title: 'Total Shares', dataIndex: 'total_shares', render: (v) => formatNumber(v) },
          { title: 'Total Invested', dataIndex: 'total_invested', render: (v) => formatCurrency(v) },
          { title: 'Share %', dataIndex: 'share_percentage', render: (v) => `${v?.toFixed(2)}%` },
        ];
      case 'allocations':
        return [
          { title: 'Account No', dataIndex: 'account_no', width: 120 },
          { title: 'Shareholder', dataIndex: 'shareholder_name', width: 160 },
          { title: 'Alloc No', dataIndex: 'allocation_no', width: 110 },
          { title: 'Round', dataIndex: 'round', width: 60 },
          { title: 'Sub Type', dataIndex: 'subscription_type', width: 90 },
          { title: 'Allocated', dataIndex: 'allocated_shares', width: 90, render: (v) => formatNumber(v) },
          { title: 'Paid', dataIndex: 'paid_shares', width: 80,
            render: (v) => <Tag color="blue">{formatNumber(v)}</Tag> },
          { title: 'Unpaid', dataIndex: 'unpaid_shares', width: 80,
            render: (v) => <Tag color="orange">{formatNumber(v)}</Tag> },
          { title: 'Paid Blocked', dataIndex: 'paid_blocked', width: 100,
            render: (v) => v > 0 ? <Tag color="red">{v}</Tag> : <Tag color="default">0</Tag> },
          { title: 'Unpaid Blocked', dataIndex: 'unpaid_blocked', width: 110,
            render: (v) => v > 0 ? <Tag color="volcano">{v}</Tag> : <Tag color="default">0</Tag> },
          { title: 'Available', dataIndex: 'available_shares', width: 90,
            render: (v) => <Tag color="green">{formatNumber(v)}</Tag> },
          { title: 'Approval', dataIndex: 'approval_status', width: 90,
            render: (s) => <Tag color={s === 'approved' ? 'green' : 'orange'}>{s}</Tag> },
        ];
      default:
        return [
          { title: 'Account', dataIndex: 'account_no' },
          { title: 'Name', key: 'name', render: (_, r) => `${r.first_name || ''} ${r.last_name || ''}` },
          { title: 'Status', dataIndex: 'status' },
        ];
    }
  };

  // ────────────────────────────────────────────────────────────────────
  // Comprehensive dividend report: three tabs over the same dataset.
  //   1. Collected & Settled — per-row breakdown of where the dividend went
  //   2. Uncollected         — focused list with per-shareholder subtotals,
  //                            ordered by who owes the most attention
  //   3. Accumulated         — per-shareholder roll-up across all fiscal
  //                            years (the accrual view)
  // ────────────────────────────────────────────────────────────────────
  const renderDividendReport = (rows, sum, fy) => {
    const fyLabel = fy ? `Fiscal Year ${fy}` : 'All Fiscal Years';
    const byShareholder = sum?.by_shareholder || [];

    const grandStats = (
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={4}><Card size="small"><Statistic title="Gross" value={sum?.total_gross || 0} prefix="ETB" precision={2} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="Tax" value={sum?.total_tax || 0} prefix="ETB" precision={2} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="Reinvested" value={sum?.total_reinvested || 0} prefix="ETB" precision={2} valueStyle={{ color: '#1677ff' }} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="Collected (cash)" value={sum?.total_collected || 0} prefix="ETB" precision={2} valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="Transferred" value={sum?.total_transferred || 0} prefix="ETB" precision={2} valueStyle={{ color: '#722ed1' }} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="Uncollected" value={sum?.total_uncollected || 0} prefix="ETB" precision={2} valueStyle={{ color: '#fa8c16' }} /></Card></Col>
      </Row>
    );

    // ---- TAB 1: Collected & Settled ----
    const collectedColumns = getColumns();
    const collectedRows = rows;
    const collectedSubtotals = byShareholder.filter(b => (b.total_collected + b.total_reinvested + b.total_transferred + b.total_blocked) > 0);

    // ---- TAB 2: Uncollected (still pending follow-up) ----
    const uncollectedRows = rows.filter(r => Number(r.uncollected_amount) > 0);
    const uncollectedSubtotals = byShareholder.filter(b => b.total_uncollected > 0);
    const uncollectedColumns = [
      { title: 'Sh. ID', key: 'shid', width: 70, render: (_, r) => r.shareholder_id ?? r.shareholder?.id ?? '-' },
      { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
      { title: 'Account', key: 'acc', render: (_, r) => r.shareholder?.account_no || '-' },
      { title: 'Fiscal Year', dataIndex: 'fiscal_year' },
      { title: 'Net (after tax)', dataIndex: 'net_dividend', render: v => formatCurrency(v) },
      { title: 'Collected so far', dataIndex: 'collected_amount', render: v => formatCurrency(v) },
      { title: 'Reinvested so far', dataIndex: 'reinvested_amount', render: v => formatCurrency(v) },
      { title: 'Still Uncollected', dataIndex: 'uncollected_amount', render: v => <Text strong style={{ color: '#cf1322' }}>{formatCurrency(v)}</Text> },
      { title: 'Status', key: 'st', render: (_, r) => (
        <Space>
          <Tag color={r.is_blocked ? 'red' : r.is_transferred ? 'purple' : 'orange'}>{r.is_blocked ? 'BLOCKED' : r.is_transferred ? 'TRANSFERRED' : 'OPEN'}</Tag>
        </Space>
      )},
    ];

    // ---- TAB 3: Accumulated (per-shareholder rollup) ----
    const accumulatedColumns = [
      { title: 'Sh. ID', dataIndex: 'shareholder_id', width: 70 },
      { title: 'Shareholder', dataIndex: 'shareholder_name' },
      { title: 'Account', dataIndex: 'account_no' },
      { title: 'Fiscal Years', dataIndex: 'fiscal_years', render: yrs => (yrs || []).map(y => <Tag key={y}>{y}</Tag>) },
      { title: '# Dividends', dataIndex: 'dividend_count', width: 90 },
      { title: 'Total Gross', dataIndex: 'total_gross', render: v => formatCurrency(v) },
      { title: 'Total Tax', dataIndex: 'total_tax', render: v => formatCurrency(v) },
      { title: 'Total Net', dataIndex: 'total_net', render: v => formatCurrency(v) },
      { title: 'Reinvested', dataIndex: 'total_reinvested', render: v => <Text style={{ color: '#1677ff' }}>{formatCurrency(v)}</Text> },
      { title: 'Collected (cash)', dataIndex: 'total_collected', render: v => <Text style={{ color: '#3f8600' }}>{formatCurrency(v)}</Text> },
      { title: 'Transferred', dataIndex: 'total_transferred', render: v => <Text style={{ color: '#722ed1' }}>{formatCurrency(v)}</Text> },
      { title: 'Blocked', dataIndex: 'total_blocked', render: v => <Text style={{ color: '#cf1322' }}>{formatCurrency(v)}</Text> },
      { title: 'Uncollected (accrued)', dataIndex: 'total_uncollected', render: v => <Text strong style={{ color: '#fa8c16' }}>{formatCurrency(v)}</Text> },
    ];

    const sumSummaryRow = (rows, cols) => {
      const tot = rows.reduce((acc, r) => {
        acc.gross += Number(r.total_gross || 0);
        acc.tax += Number(r.total_tax || 0);
        acc.net += Number(r.total_net || 0);
        acc.reinvested += Number(r.total_reinvested || 0);
        acc.collected += Number(r.total_collected || 0);
        acc.transferred += Number(r.total_transferred || 0);
        acc.blocked += Number(r.total_blocked || 0);
        acc.uncollected += Number(r.total_uncollected || 0);
        return acc;
      }, { gross: 0, tax: 0, net: 0, reinvested: 0, collected: 0, transferred: 0, blocked: 0, uncollected: 0 });
      return (
        <Table.Summary fixed>
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={4}><Text strong>Grand Total</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={1}><Text strong>{rows.length}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={2}><Text strong>{formatCurrency(tot.gross)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={3}><Text strong>{formatCurrency(tot.tax)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={4}><Text strong>{formatCurrency(tot.net)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={5}><Text strong style={{ color: '#1677ff' }}>{formatCurrency(tot.reinvested)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={6}><Text strong style={{ color: '#3f8600' }}>{formatCurrency(tot.collected)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={7}><Text strong style={{ color: '#722ed1' }}>{formatCurrency(tot.transferred)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={8}><Text strong style={{ color: '#cf1322' }}>{formatCurrency(tot.blocked)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={9}><Text strong style={{ color: '#fa8c16' }}>{formatCurrency(tot.uncollected)}</Text></Table.Summary.Cell>
          </Table.Summary.Row>
        </Table.Summary>
      );
    };

    const uncollectedSubtotalCols = [
      { title: 'Sh. ID', dataIndex: 'shareholder_id', width: 70 },
      { title: 'Shareholder', dataIndex: 'shareholder_name' },
      { title: 'Account', dataIndex: 'account_no' },
      { title: 'Fiscal Years', dataIndex: 'fiscal_years', render: yrs => (yrs || []).map(y => <Tag key={y}>{y}</Tag>) },
      { title: '# Dividends', dataIndex: 'dividend_count', width: 90 },
      { title: 'Total Net', dataIndex: 'total_net', render: v => formatCurrency(v) },
      { title: 'Collected (cash)', dataIndex: 'total_collected', render: v => <Text style={{ color: '#3f8600' }}>{formatCurrency(v)}</Text> },
      { title: 'Reinvested', dataIndex: 'total_reinvested', render: v => <Text style={{ color: '#1677ff' }}>{formatCurrency(v)}</Text> },
      { title: 'Blocked', dataIndex: 'total_blocked', render: v => <Text style={{ color: '#cf1322' }}>{formatCurrency(v)}</Text> },
      { title: 'Still Uncollected', dataIndex: 'total_uncollected', render: v => <Text strong style={{ color: '#fa8c16' }}>{formatCurrency(v)}</Text> },
    ];

    return (
      <Card size="small" title={`Dividend Report — ${fyLabel} (${sum.total || rows.length} dividends across ${byShareholder.length} shareholder${byShareholder.length === 1 ? '' : 's'})`}>
        {grandStats}
        <Tabs defaultActiveKey="detail" items={[
          {
            key: 'detail',
            label: 'Collected & Settled (Detail)',
            children: (
              <>
                <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
                  Every dividend row with the full breakdown — what was collected as cash, what was reinvested into shares, what was transferred to a beneficiary, what's currently blocked, and what's still uncollected.
                </Text>
                <Table dataSource={collectedRows} columns={collectedColumns}
                  rowKey={(r) => r.id} size="small" scroll={{ x: 1400 }}
                  pagination={{ pageSize: 30, showSizeChanger: true }} />

                <Divider>Per-Shareholder Subtotals</Divider>
                <Table dataSource={collectedSubtotals} columns={accumulatedColumns}
                  rowKey="shareholder_id" size="small" pagination={false}
                  summary={(r) => sumSummaryRow(r)} />
              </>
            ),
          },
          {
            key: 'uncollected',
            label: <span>Uncollected <Tag color="orange">{uncollectedRows.length}</Tag></span>,
            children: (
              <>
                <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
                  Dividends with money still owed to the shareholder. Use this list for follow-up.
                </Text>
                <Table dataSource={uncollectedRows} columns={uncollectedColumns}
                  rowKey={(r) => r.id} size="small" scroll={{ x: 1100 }}
                  pagination={{ pageSize: 30, showSizeChanger: true }} />

                <Divider>Per-Shareholder Outstanding</Divider>
                <Table dataSource={uncollectedSubtotals} columns={uncollectedSubtotalCols}
                  rowKey="shareholder_id" size="small" pagination={false}
                  summary={(rs) => {
                    const tot = rs.reduce((acc, r) => acc + Number(r.total_uncollected || 0), 0);
                    return (
                      <Table.Summary fixed>
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={9}><Text strong>Total still uncollected</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={1}><Text strong style={{ color: '#fa8c16' }}>{formatCurrency(tot)}</Text></Table.Summary.Cell>
                        </Table.Summary.Row>
                      </Table.Summary>
                    );
                  }}
                />
              </>
            ),
          },
          {
            key: 'accumulated',
            label: <span>Accumulated (Accrual) <Tag color="blue">{byShareholder.length}</Tag></span>,
            children: (
              <>
                <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
                  Each shareholder's accumulated dividend history across every fiscal year — the accrual view. Sorted by who has the most uncollected balance so follow-up is prioritised.
                </Text>
                <Table dataSource={byShareholder} columns={accumulatedColumns}
                  rowKey="shareholder_id" size="small" scroll={{ x: 1600 }}
                  pagination={{ pageSize: 30, showSizeChanger: true }}
                  summary={(r) => sumSummaryRow(r)}
                />
              </>
            ),
          },
        ]} />
      </Card>
    );
  };

  // ────────────────────────────────────────────────────────────────────
  // Comprehensive dividend TAX report. Surfaces the chain:
  //   Gross  −  Reinvested (no tax)  =  Taxable Gross
  //   Tax    =  bracket_rate × Taxable Gross  −  deduction
  //   Net    =  Taxable Gross − Tax
  //   Of Net: Collected (cash paid out)  +  Uncollected (still owed)
  // and shows BOTH the bracket rate (tax÷taxable, the configured 15%) and
  // the effective rate (tax÷gross) so admin can see when reinvestment has
  // depressed the effective rate.
  // ────────────────────────────────────────────────────────────────────
  const renderDividendTaxReport = (rows, sum, fy) => {
    const fyLabel = fy ? `Fiscal Year ${fy}` : 'All Fiscal Years';
    const byShareholder = sum?.by_shareholder || [];

    const grandStats = (
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={3}><Card size="small"><Statistic title="Gross" value={sum?.total_gross || 0} prefix="ETB" precision={2} /></Card></Col>
        <Col xs={12} md={3}><Card size="small"><Statistic title="Reinvested" value={sum?.total_reinvested || 0} prefix="ETB" precision={2} valueStyle={{ color: '#1677ff' }} /></Card></Col>
        <Col xs={12} md={3}><Card size="small"><Statistic title="Taxable Gross" value={sum?.total_taxable_gross || 0} prefix="ETB" precision={2} /></Card></Col>
        <Col xs={12} md={3}><Card size="small"><Statistic title="Total Tax" value={sum?.total_tax || 0} prefix="ETB" precision={2} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col xs={12} md={3}><Card size="small"><Statistic title="Net" value={sum?.total_net || 0} prefix="ETB" precision={2} valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="Collected (cash)" value={sum?.total_collected || 0} prefix="ETB" precision={2} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="Uncollected" value={sum?.total_uncollected || 0} prefix="ETB" precision={2} valueStyle={{ color: '#fa8c16' }} /></Card></Col>
      </Row>
    );

    const subtotalColumns = [
      { title: 'Sh. ID', dataIndex: 'shareholder_id', width: 70 },
      { title: 'Shareholder', dataIndex: 'shareholder_name' },
      { title: 'Account', dataIndex: 'account_no' },
      { title: 'Fiscal Years', dataIndex: 'fiscal_years', render: yrs => (yrs || []).map(y => <Tag key={y}>{y}</Tag>) },
      { title: '# Dividends', dataIndex: 'dividend_count', width: 80 },
      { title: 'Gross', dataIndex: 'total_gross', render: v => formatCurrency(v) },
      { title: 'Reinvested', dataIndex: 'total_reinvested', render: v => <Text style={{ color: '#1677ff' }}>{formatCurrency(v)}</Text> },
      { title: 'Taxable Gross', dataIndex: 'total_taxable_gross', render: v => formatCurrency(v) },
      { title: 'Tax', dataIndex: 'total_tax', render: v => <Text style={{ color: '#cf1322' }}>{formatCurrency(v)}</Text> },
      { title: 'Bracket %', key: 'br', render: (_, r) => r.total_taxable_gross > 0 ? `${((Number(r.total_tax) / Number(r.total_taxable_gross)) * 100).toFixed(2)}%` : '—' },
      { title: 'Effective %', key: 'ef', render: (_, r) => r.total_gross > 0 ? `${((Number(r.total_tax) / Number(r.total_gross)) * 100).toFixed(2)}%` : '—' },
      { title: 'Net', dataIndex: 'total_net', render: v => <Text style={{ color: '#3f8600' }}>{formatCurrency(v)}</Text> },
      { title: 'Collected', dataIndex: 'total_collected', render: v => formatCurrency(v) },
      { title: 'Uncollected', dataIndex: 'total_uncollected', render: v => <Text style={{ color: '#fa8c16' }}>{formatCurrency(v)}</Text> },
    ];

    const subtotalSummary = (rs) => {
      const tot = rs.reduce((acc, r) => {
        acc.gross += Number(r.total_gross || 0);
        acc.reinv += Number(r.total_reinvested || 0);
        acc.tax += Number(r.total_tax || 0);
        acc.taxable += Number(r.total_taxable_gross || 0);
        acc.net += Number(r.total_net || 0);
        acc.coll += Number(r.total_collected || 0);
        acc.unc += Number(r.total_uncollected || 0);
        return acc;
      }, { gross: 0, reinv: 0, tax: 0, taxable: 0, net: 0, coll: 0, unc: 0 });
      const bracket = tot.taxable > 0 ? (tot.tax / tot.taxable) * 100 : 0;
      const effective = tot.gross > 0 ? (tot.tax / tot.gross) * 100 : 0;
      return (
        <Table.Summary fixed>
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={5}><Text strong>Grand Total</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={1}><Text strong>{formatCurrency(tot.gross)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={2}><Text strong style={{ color: '#1677ff' }}>{formatCurrency(tot.reinv)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={3}><Text strong>{formatCurrency(tot.taxable)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={4}><Text strong style={{ color: '#cf1322' }}>{formatCurrency(tot.tax)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={5}><Text strong>{bracket.toFixed(2)}%</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={6}><Text strong>{effective.toFixed(2)}%</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={7}><Text strong style={{ color: '#3f8600' }}>{formatCurrency(tot.net)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={8}><Text strong>{formatCurrency(tot.coll)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={9}><Text strong style={{ color: '#fa8c16' }}>{formatCurrency(tot.unc)}</Text></Table.Summary.Cell>
          </Table.Summary.Row>
        </Table.Summary>
      );
    };

    return (
      <Card size="small" title={`Dividend Tax Report — ${fyLabel}`}>
        {grandStats}
        <Tabs defaultActiveKey="detail" items={[
          {
            key: 'detail',
            label: 'Per-Dividend Detail',
            children: (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                  <strong>Bracket %</strong> = Tax ÷ Taxable Gross — the configured rate (e.g. 15%). <strong>Effective %</strong> = Tax ÷ Gross — what the shareholder's tax-to-gross ratio looks like after reinvested portions are excluded. Differs from bracket rate when reinvested &gt; 0.
                </Text>
                <Table dataSource={rows} columns={getColumns()}
                  rowKey={(r) => r.id} size="small" scroll={{ x: 1600 }}
                  pagination={{ pageSize: 30, showSizeChanger: true }} />
              </>
            ),
          },
          {
            key: 'subtotals',
            label: <span>Per-Shareholder Subtotals <Tag color="blue">{byShareholder.length}</Tag></span>,
            children: (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                  Each shareholder's accumulated tax position across every fiscal year in scope. Sorted by total tax owed (largest first).
                </Text>
                <Table dataSource={byShareholder} columns={subtotalColumns}
                  rowKey="shareholder_id" size="small" scroll={{ x: 1700 }}
                  pagination={{ pageSize: 30, showSizeChanger: true }}
                  summary={subtotalSummary}
                />
              </>
            ),
          },
        ]} />
      </Card>
    );
  };

  // Summary statistics for the current report
  const renderSummary = () => {
    if (!data.length) return null;
    const items = [];

    if (summary.total !== undefined)
      items.push({ title: 'Total Records', value: summary.total });
    if (summary.total_amount !== undefined)
      items.push({ title: 'Total Amount', value: summary.total_amount, prefix: 'ETB', precision: 2 });
    if (summary.total_gross !== undefined) {
      items.push({ title: 'Total Gross', value: summary.total_gross, prefix: 'ETB', precision: 2 });
      items.push({ title: 'Total Tax', value: summary.total_tax, prefix: 'ETB', precision: 2 });
      items.push({ title: 'Total Net', value: summary.total_net, prefix: 'ETB', precision: 2 });
      items.push({ title: 'Total Collected', value: summary.total_collected, prefix: 'ETB', precision: 2 });
    }
    if (summary.total_capital !== undefined)
      items.push({ title: 'Foreign Capital', value: summary.total_capital, prefix: 'ETB', precision: 2 });
    if (summary.total_shares !== undefined && summary.total_allocated === undefined)
      items.push({ title: 'Total Shares', value: summary.total_shares });
    if (summary.threshold_pct !== undefined)
      items.push({ title: 'Threshold', value: summary.threshold_pct, suffix: '%' });
    // Allocation Register summary
    if (summary.total_allocated !== undefined) {
      items.push({ title: 'Total Allocated', value: summary.total_allocated });
      items.push({ title: 'Total Paid', value: summary.total_paid });
      items.push({ title: 'Total Unpaid', value: summary.total_unpaid });
      items.push({ title: 'Total Available', value: summary.total_available });
    }
    // Block/Release report summary
    if (summary.active_blocked !== undefined) {
      items.push({ title: 'Active Blocked', value: summary.active_blocked });
      items.push({ title: 'Total Blocked (all)', value: summary.total_blocked });
    }
    // Sex / gender breakdown summary
    if (summary.counts !== undefined && summary.shares_by_gender !== undefined) {
      if (summary.male_count > 0) {
        items.push({ title: 'Male', value: summary.male_count, valueStyle: { color: '#1677ff' } });
      }
      if (summary.female_count > 0) {
        items.push({ title: 'Female', value: summary.female_count, valueStyle: { color: '#eb2f96' } });
      }
      if (summary.other_count > 0) {
        items.push({ title: 'Other', value: summary.other_count, valueStyle: { color: '#722ed1' } });
      }
      if (summary.unspecified_count > 0) {
        items.push({ title: 'Unspecified', value: summary.unspecified_count, valueStyle: { color: '#8c8c8c' } });
      }
    }
    // Age report summary
    if (summary.average_age !== undefined) {
      items.push({ title: 'Avg Age', value: summary.average_age, precision: 1, suffix: ' yrs' });
      items.push({ title: 'Youngest', value: summary.actual_min_age, suffix: ' yrs' });
      items.push({ title: 'Oldest', value: summary.actual_max_age, suffix: ' yrs' });
      if (summary.shareholders_without_dob > 0) {
        items.push({ title: 'No DOB on file', value: summary.shareholders_without_dob, valueStyle: { color: '#cf1322' } });
      }
    }

    if (!items.length) return null;

    return (
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {items.map((item, i) => (
          <Col key={i} span={Math.max(4, Math.floor(24 / items.length))}>
            <Card size="small">
              <Statistic {...item} valueStyle={{ fontSize: 18 }} />
            </Card>
          </Col>
        ))}
      </Row>
    );
  };

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}><BankOutlined /> Reports</Title>
      </Row>

      <Tabs defaultActiveKey="general" items={[
        {
          key: 'general',
          label: 'General Reports',
          children: (
            <>
              <Card size="small" style={{ marginBottom: 16 }}>
                <Row gutter={[16, 12]} align="middle">
                  <Col xs={24} md={8}>
                    <Select
                      placeholder="Select report type"
                      style={{ width: '100%' }}
                      options={reportGroups}
                      value={reportType || undefined}
                      onChange={(v) => { setReportType(v); setData([]); setSummary({}); }}
                      showSearch
                      optionFilterProp="label"
                    />
                  </Col>

                  {dateFilterReports.includes(reportType) && (
                    <Col xs={24} md={6}>
                      <RangePicker style={{ width: '100%' }} onChange={setDateRange}
                        placeholder={['Start Date', 'End Date']} />
                    </Col>
                  )}

                  {ageFilterReports.includes(reportType) && (
                    <Col xs={24} md={6}>
                      <Space.Compact style={{ width: '100%' }}>
                        <InputNumber
                          placeholder="Min age" min={0} max={150}
                          value={minAge}
                          onChange={(v) => setMinAge(v ?? 0)}
                          style={{ width: '50%' }}
                          addonBefore="Min"
                        />
                        <InputNumber
                          placeholder="Max age" min={0} max={150}
                          value={maxAge}
                          onChange={(v) => setMaxAge(v ?? 150)}
                          style={{ width: '50%' }}
                          addonBefore="Max"
                        />
                      </Space.Compact>
                    </Col>
                  )}

                  {sexFilterReports.includes(reportType) && (
                    <Col xs={24} md={4}>
                      <Select
                        placeholder="All genders"
                        style={{ width: '100%' }}
                        allowClear
                        value={genderFilter || undefined}
                        onChange={(v) => setGenderFilter(v || '')}
                        options={[
                          { value: 'male', label: 'Male' },
                          { value: 'female', label: 'Female' },
                          { value: 'other', label: 'Other' },
                          { value: 'unspecified', label: 'Unspecified (no value)' },
                        ]}
                      />
                    </Col>
                  )}

                  {fiscalYearReports.includes(reportType) && (
                    <Col xs={24} md={4}>
                      <Select
                        placeholder={fiscalYearOptions.length === 0 ? 'No fiscal years yet' : 'Fiscal Year (all if blank)'}
                        style={{ width: '100%' }}
                        allowClear
                        value={fiscalYear || undefined}
                        onChange={(v) => setFiscalYear(v || '')}
                        options={fiscalYearOptions}
                        notFoundContent={fiscalYearOptions.length === 0 ? 'Create a fiscal year in Dividend Settings first' : undefined}
                      />
                    </Col>
                  )}

                  <Col>
                    <Space>
                      <Button type="primary" icon={<SearchOutlined />} onClick={fetchReport}
                        loading={loading} disabled={!reportType}>
                        Generate
                      </Button>
                      {data.length > 0 && (
                        <>
                          <Button icon={<FileExcelOutlined />} onClick={exportToExcel}
                            style={{ color: '#217346', borderColor: '#217346' }}>
                            Export Excel
                          </Button>
                          <Button icon={<PrinterOutlined />} onClick={handlePrint}>
                            Print
                          </Button>
                        </>
                      )}
                    </Space>
                  </Col>
                </Row>
              </Card>

              {renderSummary()}

              {data.length > 0 ? (
                reportType === 'dividends'
                  ? renderDividendReport(data, summary, fiscalYear)
                  : reportType === 'dividend-tax'
                  ? renderDividendTaxReport(data, summary, fiscalYear)
                  : (
                    <Card size="small"
                      title={`${allReportTypes.find(r => r.value === reportType)?.label || 'Report'} (${summary.total || data.length} records)`}>
                      <Table dataSource={data} columns={getColumns()}
                        rowKey={(r) => r.id || r.shareholder_id || r.date || Math.random()}
                        size="small" scroll={{ x: 900 }}
                        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100],
                          showTotal: (t) => `Total ${t} records` }}
                      />
                    </Card>
                  )
              ) : (
                !loading && reportType && <Empty description="Select a report type and click Generate" />
              )}
            </>
          ),
        },
        {
          key: 'statement',
          label: 'Individual Statement',
          children: (
            <>
              <Card size="small" style={{ marginBottom: 16 }}>
                <Row gutter={16} align="middle">
                  <Col xs={24} md={10}>
                    <Select
                      showSearch
                      filterOption={false}
                      onSearch={handleSearchSh}
                      options={shareholders}
                      placeholder="Search by name, account no, or phone..."
                      style={{ width: '100%' }}
                      onChange={(v) => setStatementId(v)}
                      loading={searchLoading}
                      notFoundContent={searchLoading ? 'Searching...' : 'Type at least 2 characters to search'}
                      allowClear
                      onClear={() => { setStatement(null); setStatementId(null); }}
                      suffixIcon={<UserOutlined />}
                    />
                  </Col>
                  <Col>
                    <Space>
                      <Button type="primary" icon={<SearchOutlined />}
                        onClick={fetchStatement} loading={loading} disabled={!statementId}>
                        Get Statement
                      </Button>
                      {statement && (
                        <>
                          <Tooltip title="Off (default): the statement shows only approved entries — investments, subscriptions, allocations, and transfers. Turn on to also include rejected items (for audit/diagnostic).">
                            <Space size={4}>
                              <Switch
                                size="small"
                                checked={includeRejected}
                                onChange={setIncludeRejected}
                              />
                              <Text style={{ fontSize: 12, color: includeRejected ? '#cf1322' : '#666' }}>
                                Include rejected
                              </Text>
                            </Space>
                          </Tooltip>
                          <Button icon={<FileExcelOutlined />} onClick={exportStatementToExcel}
                            style={{ color: '#217346', borderColor: '#217346' }}>
                            Export Excel
                          </Button>
                          <Button icon={<PrinterOutlined />} onClick={handlePrint}>
                            Print
                          </Button>
                        </>
                      )}
                    </Space>
                  </Col>
                </Row>
              </Card>

              {statement && (
                // Paper-styled container — visual parity with the printed PDF.
                <div style={{
                  background: '#fff',
                  maxWidth: 1080,
                  margin: '0 auto',
                  padding: '32px 40px',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                  borderRadius: 4,
                  fontFamily: "'Segoe UI', Arial, sans-serif",
                  color: '#333',
                }}>
                  {/* Bank statement header */}
                  <div style={{
                    textAlign: 'center',
                    borderBottom: '3px double #1a3a5c',
                    paddingBottom: 16,
                    marginBottom: 18,
                  }}>
                    <div style={{ color: '#1a3a5c', fontSize: 24, fontWeight: 700, letterSpacing: 1 }}>
                      ZEMEN BANK S.C.
                    </div>
                    <div style={{ color: '#1a3a5c', fontSize: 15, marginTop: 2 }}>
                      ዘመን ባንክ አ.ማ.
                    </div>
                    <div style={{ color: '#333', fontSize: 17, fontWeight: 600, marginTop: 12 }}>
                      Shareholder Statement
                    </div>
                  </div>

                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: 12, color: '#666', marginBottom: 18,
                  }}>
                    <span>Generated: {dayjs().format('MMMM D, YYYY h:mm A')}</span>
                    <span>Statement for Account No {statement.shareholder?.account_no}</span>
                  </div>

                  {/* Account summary — bordered box matching the print version */}
                  <div style={{
                    background: '#f0f5ff',
                    border: '1px solid #adc6ff',
                    borderRadius: 4,
                    padding: 16,
                    marginBottom: 22,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '14px 24px',
                  }}>
                    {(() => {
                      // Compute from the allocations array (always present in
                      // the payload) so the box is correct regardless of
                      // backend rollup-field availability. Holding = total
                      // allocated = paid + unpaid, so the three reconcile.
                      const allocs = statement.allocations || [];
                      const hasAllocs = allocs.length > 0;
                      const holding = hasAllocs
                        ? allocs.reduce((s, a) => s + (a.allocated_shares || 0), 0)
                        : (statement.total_shares ?? 0);
                      const tp = allocs.reduce((s, a) => s + (a.paid_shares || 0), 0);
                      const tu = allocs.reduce((s, a) => s + (a.unpaid_shares || 0), 0);
                      const tb = allocs.reduce((s, a) => s + (a.blocked_shares || 0), 0);
                      return [
                        ['Account No', statement.shareholder?.account_no || '—'],
                        ['Name', `${statement.shareholder?.first_name || ''} ${statement.shareholder?.middle_name || ''} ${statement.shareholder?.last_name || ''}`.replace(/\s+/g, ' ').trim()],
                        ['Type', statement.shareholder?.shareholder_type || '—'],
                        ['Total Shares (holding)', formatNumber(holding)],
                        ['Total Invested', formatCurrency(statement.total_invested)],
                        ['TIN', statement.shareholder?.tin || '—'],
                        ['Phone', statement.shareholder?.phone || '—'],
                        ['Status', (statement.shareholder?.status || '—').toUpperCase()],
                        ...(hasAllocs ? [
                          ['Paid Shares', formatNumber(tp)],
                          ['Unpaid Shares', formatNumber(tu)],
                          ['Total Blocked', formatNumber(tb)],
                        ] : []),
                      ];
                    })().map(([label, value]) => (
                      <div key={label}>
                        <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a3a5c', marginTop: 2 }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Sub-tabs: Statement (default) | Share Certificate Register */}
                  <Tabs
                    activeKey={statementSubTab}
                    onChange={setStatementSubTab}
                    style={{ marginBottom: 8 }}
                    items={[
                      { key: 'statement', label: 'Statement' },
                      { key: 'certificate', label: 'Share Certificate Register' },
                    ]}
                  />

                  {statementSubTab === 'statement' && (<>
                  {/* Investments */}
                  {(() => {
                    const investments = filterApproved(statement.investments);
                    const rejectedCount = (statement.investments?.length || 0) - investments.length;
                    return (
                  <div style={{ marginBottom: 18 }}>
                    <div style={statementSectionTitleStyle}>
                      Investments ({investments.length})
                      {rejectedCount > 0 && (
                        <Text type="secondary" style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
                          · {rejectedCount} rejected hidden
                        </Text>
                      )}
                    </div>
                    <Table dataSource={investments} rowKey="id" size="small" pagination={false}
                      columns={[
                        { title: 'Date', dataIndex: 'payment_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
                        { title: 'Amount', dataIndex: 'amount', render: (v) => formatCurrency(v) },
                        { title: 'Shares', dataIndex: 'number_of_shares', render: (v) => formatNumber(v) },
                        { title: 'Par Value', dataIndex: 'par_value', render: (v) => formatCurrency(v) },
                        { title: 'Method', dataIndex: 'payment_method' },
                        { title: 'Reference', dataIndex: 'reference_no', render: v => v || '—' },
                        { title: 'Status', dataIndex: 'approval_status', render: (s) => <Tag color={s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange'}>{s}</Tag> },
                      ]}
                    />
                  </div>
                  );})()}

                  {/* Subscriptions */}
                  {(() => {
                    const subscriptions = filterApproved(statement.subscriptions);
                    if (subscriptions.length === 0) return null;
                    const rejectedCount = (statement.subscriptions?.length || 0) - subscriptions.length;
                    return (
                    <div style={{ marginBottom: 18 }}>
                      <div style={statementSectionTitleStyle}>
                        Subscriptions ({subscriptions.length})
                        {rejectedCount > 0 && (
                          <Text type="secondary" style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
                            · {rejectedCount} rejected hidden
                          </Text>
                        )}
                      </div>
                      <Table dataSource={subscriptions} rowKey="id" size="small" pagination={false}
                        columns={[
                          { title: 'Shares', dataIndex: 'number_of_shares' },
                          { title: 'Amount', dataIndex: 'share_amount', render: (v) => formatCurrency(v) },
                          { title: 'Expiry', dataIndex: 'expiry_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
                          { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'active' ? 'green' : s === 'extended' ? 'blue' : 'red'}>{s}</Tag> },
                        ]}
                      />
                    </div>
                    );
                  })()}

                  {/* Dividends */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={statementSectionTitleStyle}>
                      Dividends ({statement.dividends?.length || 0})
                    </div>
                    <Table dataSource={statement.dividends || []} rowKey="id" size="small" pagination={false}
                      columns={[
                        { title: 'Fiscal Year', dataIndex: 'fiscal_year' },
                        { title: 'Gross', dataIndex: 'gross_dividend', render: (v) => formatCurrency(v) },
                        { title: 'Tax', dataIndex: 'tax_amount', render: (v) => formatCurrency(v) },
                        { title: 'Net', dataIndex: 'net_dividend', render: (v) => formatCurrency(v) },
                        { title: 'Collected', dataIndex: 'collected_amount', render: (v) => formatCurrency(v) },
                        { title: 'Uncollected', dataIndex: 'uncollected_amount', render: (v) => formatCurrency(v) },
                        { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'collected' ? 'green' : s === 'partial' ? 'blue' : 'orange'}>{s}</Tag> },
                      ]}
                    />
                  </div>

                  {/* Allocations */}
                  {(() => {
                    const allocations = filterApproved(statement.allocations);
                    if (allocations.length === 0) return null;
                    const rejectedCount = (statement.allocations?.length || 0) - allocations.length;
                    return (
                    <div style={{ marginBottom: 18 }}>
                      <div style={statementSectionTitleStyle}>
                        Allocations ({allocations.length})
                        {rejectedCount > 0 && (
                          <Text type="secondary" style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
                            · {rejectedCount} rejected hidden
                          </Text>
                        )}
                      </div>
                      <Table dataSource={allocations} rowKey="id" size="small" pagination={false}
                        columns={[
                          { title: 'Alloc No', dataIndex: 'allocation_no', width: 110 },
                          { title: 'Round', dataIndex: 'round', width: 60 },
                          { title: 'Type', dataIndex: 'subscription_type', width: 90 },
                          { title: 'Allocated', dataIndex: 'allocated_shares', width: 90, render: (v) => formatNumber(v) },
                          { title: 'Paid', dataIndex: 'paid_shares', width: 80, render: (v) => <Tag color="blue">{formatNumber(v)}</Tag> },
                          { title: 'Unpaid', dataIndex: 'unpaid_shares', width: 80, render: (v) => <Tag color="orange">{formatNumber(v)}</Tag> },
                          { title: 'Paid Blocked', dataIndex: 'paid_blocked', width: 100, render: (v) => v > 0 ? <Tag color="red">{v}</Tag> : <Tag color="default">0</Tag> },
                          { title: 'Unpaid Blocked', dataIndex: 'unpaid_blocked', width: 110, render: (v) => v > 0 ? <Tag color="volcano">{v}</Tag> : <Tag color="default">0</Tag> },
                          { title: 'Available', dataIndex: 'available_shares', width: 90, render: (v) => <Tag color="green">{formatNumber(v)}</Tag> },
                          { title: 'Approval', dataIndex: 'approval_status', width: 90, render: (s) => <Tag color={s === 'approved' ? 'green' : 'orange'}>{s}</Tag> },
                        ]}
                      />
                    </div>
                    );
                  })()}

                  {/* Transfers */}
                  {(() => {
                    const transfers = filterApproved(statement.transfers);
                    if (transfers.length === 0) return null;
                    const rejectedCount = (statement.transfers?.length || 0) - transfers.length;
                    return (
                    <div style={{ marginBottom: 18 }}>
                      <div style={statementSectionTitleStyle}>
                        Transfers ({transfers.length})
                        {rejectedCount > 0 && (
                          <Text type="secondary" style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
                            · {rejectedCount} rejected hidden
                          </Text>
                        )}
                      </div>
                      <Table dataSource={transfers} rowKey="id" size="small" pagination={false}
                        expandable={{
                          expandedRowRender: (record) => (record.lines?.length || 0) > 0 ? (
                            <Table dataSource={record.lines} rowKey="id" size="small" pagination={false}
                              style={{ margin: '4px 0' }}
                              columns={[
                                { title: 'From Allocation', key: 'from_alloc', width: 130,
                                  render: (_, l) => l.from_allocation
                                    ? <Tag color="blue">{l.from_allocation.allocation_no}</Tag>
                                    : l.from_allocation_id
                                      ? <Tag color="warning">Alloc #{l.from_allocation_id}</Tag>
                                      : <Tag color="default">—</Tag> },
                                { title: 'Paid Transferred', dataIndex: 'paid_shares_to_transfer', width: 120, render: (v) => v > 0 ? <Tag color="blue">{v} paid</Tag> : <Tag color="default">0</Tag> },
                                { title: 'Unpaid Transferred', dataIndex: 'unpaid_shares_to_transfer', width: 130, render: (v) => v > 0 ? <Tag color="orange">{v} unpaid</Tag> : <Tag color="default">0</Tag> },
                              ]}
                            />
                          ) : (
                            <Tag color="default" style={{ margin: '4px 8px' }}>Legacy transfer — per-allocation breakdown not available</Tag>
                          ),
                          rowExpandable: () => true,
                        }}
                        columns={[
                          { title: 'Batch', dataIndex: 'batch_no', width: 110 },
                          { title: 'Date', dataIndex: 'transfer_date', width: 100, render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
                          { title: 'Total Shares', dataIndex: 'number_of_shares', width: 100 },
                          { title: 'Paid', key: 'paid', width: 80,
                            render: (_, r) => {
                              if (!r.lines?.length) return <Tag color="default">—</Tag>;
                              const tot = r.lines.reduce((s, l) => s + (l.paid_shares_to_transfer || 0), 0);
                              return tot > 0 ? <Tag color="blue">{tot}</Tag> : <Tag color="default">0</Tag>;
                            }},
                          { title: 'Unpaid', key: 'unpaid', width: 80,
                            render: (_, r) => {
                              if (!r.lines?.length) return <Tag color="default">—</Tag>;
                              const tot = r.lines.reduce((s, l) => s + (l.unpaid_shares_to_transfer || 0), 0);
                              return tot > 0 ? <Tag color="orange">{tot}</Tag> : <Tag color="default">0</Tag>;
                            }},
                          { title: 'Amount', dataIndex: 'transfer_amount', width: 120, render: (v) => formatCurrency(v) },
                          { title: 'Type', dataIndex: 'transfer_type', width: 90 },
                          { title: 'Status', dataIndex: 'status', width: 90, render: (s) => <Tag color={s === 'approved' ? 'green' : 'orange'}>{s}</Tag> },
                        ]}
                      />
                    </div>
                    );
                  })()}

                  {/* Blocks */}
                  {statement.blocks?.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div style={statementSectionTitleStyle}>
                        Share Blocks ({statement.blocks.length})
                      </div>
                      <Table dataSource={statement.blocks} rowKey="id" size="small" pagination={false}
                        columns={[
                          { title: 'Allocation', key: 'alloc', width: 130,
                            render: (_, r) => r.allocation
                              ? <Tag color="blue">{r.allocation.allocation_no}</Tag>
                              : r.allocation_id
                                ? <Tag color="orange">Alloc #{r.allocation_id}</Tag>
                                : <Tag color="red">Legacy — no alloc</Tag> },
                          { title: 'Block Type', dataIndex: 'block_type', width: 100 },
                          { title: 'Shares Type', dataIndex: 'shares_type', width: 100,
                            render: (s) => <Tag color={s === 'paid' ? 'blue' : s === 'unpaid' ? 'orange' : 'purple'}>{s || '-'}</Tag> },
                          { title: 'Blocked Shares', key: 'bs', width: 140,
                            render: (_, r) => {
                              if (r.shares_type === 'both') {
                                const p = r.paid_shares_to_block || 0;
                                const u = r.unpaid_shares_to_block || 0;
                                if (p === 0 && u === 0) return <Tag color="red">{r.block_shares} total</Tag>;
                                return <Space size={2}><Tag color="blue">{p} paid</Tag><Tag color="orange">{u} unpaid</Tag></Space>;
                              }
                              return <Tag color={r.shares_type === 'paid' ? 'blue' : 'orange'}>{r.block_shares}</Tag>;
                            }},
                          { title: 'Amount', dataIndex: 'block_amount_birr', width: 110, render: (v) => formatCurrency(v) },
                          { title: 'Reason', dataIndex: 'reason' },
                          { title: 'Released', key: 'released', width: 80, render: (_, r) => <Tag color={r.is_released ? 'green' : 'red'}>{r.is_released ? 'Yes' : 'No'}</Tag> },
                        ]}
                      />
                    </div>
                  )}
                  </>)}

                  {statementSubTab === 'certificate' && (() => {
                    const reg = buildCertificateRegister(statement);
                    return (
                      <div style={{ marginBottom: 18 }}>
                        <div style={statementSectionTitleStyle}>
                          Share Certificate Register ({reg.rows.length})
                        </div>
                        <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
                          Each row is a paid-up share tranche issued to the shareholder. <b>ceri-no From / To</b> is computed cumulatively in chronological order.
                          {!includeRejected && ' Only approved investments are shown.'}
                        </div>
                        <Table
                          dataSource={reg.rows}
                          rowKey="key"
                          size="small"
                          pagination={false}
                          bordered
                          scroll={{ x: 1400 }}
                          summary={() => (
                            <Table.Summary fixed>
                              <Table.Summary.Row style={{ background: '#d9d9d9', fontWeight: 700 }}>
                                <Table.Summary.Cell index={0} colSpan={3}>
                                  Total Paid up As of {dayjs().format('MMM DD/YYYY')}
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={3} colSpan={7} />
                                <Table.Summary.Cell index={10} align="right">{formatCurrency(reg.total_amount)}</Table.Summary.Cell>
                                <Table.Summary.Cell index={11} align="right">{formatNumber(reg.total_shares)}</Table.Summary.Cell>
                              </Table.Summary.Row>
                            </Table.Summary>
                          )}
                          columns={[
                            { title: 'SH-ID', dataIndex: 'sh_id', width: 70, align: 'center' },
                            { title: 'Certificate No.', dataIndex: 'cert_no', width: 110, render: v => v || '—' },
                            { title: 'Pad No', dataIndex: 'pad_no', width: 80, render: v => v || '—' },
                            { title: 'Issuance Status', dataIndex: 'issuance_status', width: 110,
                              render: s => s ? <Tag color={s === 'Issued' ? 'green' : 'orange'}>{s}</Tag> : '—' },
                            { title: 'ceri-no From', dataIndex: 'from_no', width: 100, align: 'right',
                              render: v => v ? formatNumber(v) : '—' },
                            { title: 'ceri-no To', dataIndex: 'to_no', width: 100, align: 'right',
                              render: v => v ? formatNumber(v) : '—' },
                            { title: 'Amharic Date of Registration', dataIndex: 'amharic_date', width: 150, render: v => v || '—' },
                            { title: 'Date of Registration', dataIndex: 'date_of_registration', width: 120,
                              render: d => d ? dayjs(d).format('D-MMM-YY') : '—' },
                            { title: 'Name of the Shareholder', dataIndex: 'english_name', width: 200 },
                            { title: 'Amharic Name of the Shareholder', dataIndex: 'amharic_name', width: 200,
                              render: v => v || '—' },
                            { title: 'Share Paid-up', dataIndex: 'share_paid_up', width: 140, align: 'right',
                              render: v => formatCurrency(v) },
                            { title: 'Share Amount', dataIndex: 'share_amount', width: 110, align: 'right',
                              render: v => formatNumber(v) },
                          ]}
                        />
                      </div>
                    );
                  })()}

                  {/* Statement footer */}
                  <div style={{
                    marginTop: 30, paddingTop: 12, borderTop: '1px solid #ddd',
                    textAlign: 'center', fontSize: 11, color: '#999',
                  }}>
                    This is a system-generated statement. For any inquiries, contact the company secretariat.
                  </div>
                </div>
              )}
            </>
          ),
        },
      ]} />
    </div>
  );
}
