import { useState, useCallback } from 'react';
import {
  Table, Button, Card, Select, DatePicker, Space, Tag, Tabs,
  message, Typography, Row, Col, Descriptions, Statistic, Divider, Empty,
} from 'antd';
import {
  DownloadOutlined, SearchOutlined, PrinterOutlined,
  FileExcelOutlined, UserOutlined, BankOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { getReport, getShareholderStatement, searchShareholders } from '../services/api';
import { formatCurrency, formatNumber } from '../utils/format';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const reportGroups = [
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

// Flatten for label lookup
const allReportTypes = reportGroups.flatMap(g => g.options);

export default function Reports() {
  const [reportType, setReportType] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({});
  const [dateRange, setDateRange] = useState(null);
  const [fiscalYear, setFiscalYear] = useState('');
  const [statementId, setStatementId] = useState(null);
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

  const exportStatementToExcel = () => {
    if (!statement) return;
    const wb = XLSX.utils.book_new();
    const sh = statement.shareholder;
    // Summary sheet
    const summaryData = [
      ['ZEMEN BANK S.C. - Shareholder Statement'],
      [],
      ['Account No', sh?.account_no],
      ['Name', `${sh?.first_name} ${sh?.middle_name || ''} ${sh?.last_name}`],
      ['Type', sh?.shareholder_type],
      ['Phone', sh?.phone],
      ['Total Shares', statement.total_shares],
      ['Total Invested', statement.total_invested],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

    // Investments sheet
    if (statement.investments?.length) {
      const invHeaders = ['Date', 'Amount', 'Shares', 'Method', 'Reference', 'Status'];
      const invRows = statement.investments.map(i => [
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
    if (statement.allocations?.length) {
      const alHeaders = ['Alloc No', 'Round', 'Sub Type', 'Allocated', 'Paid', 'Unpaid', 'Paid Blocked', 'Unpaid Blocked', 'Available', 'Approval'];
      const alRows = statement.allocations.map(a => [
        a.allocation_no, a.round, a.subscription_type,
        a.allocated_shares, a.paid_shares, a.unpaid_shares,
        a.paid_blocked, a.unpaid_blocked, a.available_shares, a.approval_status,
      ]);
      const wsA = XLSX.utils.aoa_to_sheet([alHeaders, ...alRows]);
      XLSX.utils.book_append_sheet(wb, wsA, 'Allocations');
    }

    // Transfers sheet
    if (statement.transfers?.length) {
      const trHeaders = ['Batch', 'Date', 'Total Shares', 'Paid', 'Unpaid', 'Amount', 'Type', 'Status', 'From Allocation(s)'];
      const trRows = statement.transfers.map(t => {
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
  const handlePrint = () => {
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
      printWindow.document.write(`
        <div class="summary-box">
          <div class="item"><div class="label">Account No</div><div class="value">${sh?.account_no || '-'}</div></div>
          <div class="item"><div class="label">Name</div><div class="value">${sh?.first_name} ${sh?.middle_name || ''} ${sh?.last_name}</div></div>
          <div class="item"><div class="label">Type</div><div class="value">${sh?.shareholder_type || '-'}</div></div>
          <div class="item"><div class="label">Total Shares</div><div class="value">${formatNumber(statement.total_shares)}</div></div>
          <div class="item"><div class="label">Total Invested</div><div class="value">${formatCurrency(statement.total_invested)}</div></div>
          ${statement.allocations?.length > 0 ? (() => {
            const tp = statement.allocations.reduce((s, a) => s + (a.paid_shares || 0), 0);
            const tu = statement.allocations.reduce((s, a) => s + (a.unpaid_shares || 0), 0);
            const tb = statement.allocations.reduce((s, a) => s + (a.paid_blocked || 0) + (a.unpaid_blocked || 0), 0);
            return `<div class="item"><div class="label">Paid Shares</div><div class="value">${formatNumber(tp)}</div></div>
            <div class="item"><div class="label">Unpaid Shares</div><div class="value">${formatNumber(tu)}</div></div>
            <div class="item"><div class="label">Total Blocked</div><div class="value">${formatNumber(tb)}</div></div>`;
          })() : ''}
        </div>
      `);

      // Investments table
      if (statement.investments?.length) {
        printWindow.document.write(`<div class="section-title">Investments (${statement.investments.length})</div><table><tr><th>Date</th><th>Amount</th><th>Shares</th><th>Method</th><th>Reference</th></tr>`);
        statement.investments.forEach(i => {
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
      if (statement.allocations?.length) {
        printWindow.document.write(`<div class="section-title">Allocations (${statement.allocations.length})</div><table><tr><th>Alloc No</th><th>Round</th><th>Type</th><th>Allocated</th><th>Paid</th><th>Unpaid</th><th>Paid Blocked</th><th>Unpaid Blocked</th><th>Available</th><th>Approval</th></tr>`);
        statement.allocations.forEach(a => {
          printWindow.document.write(`<tr><td>${a.allocation_no}</td><td>${a.round || '-'}</td><td>${a.subscription_type || '-'}</td><td>${formatNumber(a.allocated_shares)}</td><td>${formatNumber(a.paid_shares)}</td><td>${formatNumber(a.unpaid_shares)}</td><td>${a.paid_blocked || 0}</td><td>${a.unpaid_blocked || 0}</td><td>${formatNumber(a.available_shares)}</td><td>${a.approval_status}</td></tr>`);
        });
        printWindow.document.write('</table>');
      }

      // Transfers table
      if (statement.transfers?.length) {
        printWindow.document.write(`<div class="section-title">Transfers (${statement.transfers.length})</div><table><tr><th>Batch</th><th>Date</th><th>Total Shares</th><th>Paid</th><th>Unpaid</th><th>Amount</th><th>Type</th><th>Status</th><th>From Allocation(s)</th></tr>`);
        statement.transfers.forEach(t => {
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
          { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
          { title: 'Fiscal Year', dataIndex: 'fiscal_year' },
          { title: 'W.Avg Shares', dataIndex: 'weighted_avg_shares', render: (v) => v?.toFixed(2) },
          { title: 'Gross', dataIndex: 'gross_dividend', render: (v) => formatCurrency(v) },
          { title: 'Tax', dataIndex: 'tax_amount', render: (v) => formatCurrency(v) },
          { title: 'Net', dataIndex: 'net_dividend', render: (v) => formatCurrency(v) },
          { title: 'Collected', dataIndex: 'collected_amount', render: (v) => formatCurrency(v) },
          { title: 'Uncollected', dataIndex: 'uncollected_amount', render: (v) => formatCurrency(v) },
          { title: 'Status', key: 'status', render: (_, r) => (
            <Space>
              <Tag color={r.status === 'collected' ? 'green' : r.status === 'partial' ? 'blue' : r.status === 'transferred' ? 'purple' : 'orange'}>{r.status}</Tag>
              {r.is_blocked && <Tag color="red">BLOCKED</Tag>}
            </Space>
          )},
        ];
      case 'dividend-tax':
        return [
          { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
          { title: 'Fiscal Year', dataIndex: 'fiscal_year' },
          { title: 'Gross Dividend', dataIndex: 'gross_dividend', render: (v) => formatCurrency(v) },
          { title: 'Tax Amount', dataIndex: 'tax_amount', render: (v) => formatCurrency(v) },
          { title: 'Tax Rate', key: 'rate', render: (_, r) => r.gross_dividend > 0 ? `${((r.tax_amount / r.gross_dividend) * 100).toFixed(1)}%` : '-' },
          { title: 'Net Dividend', dataIndex: 'net_dividend', render: (v) => formatCurrency(v) },
        ];
      case 'top-shareholders':
        return [
          { title: 'Account', dataIndex: 'account_no' },
          { title: 'Name', dataIndex: 'name' },
          { title: 'Total Shares', dataIndex: 'total_shares', render: (v) => formatNumber(v) },
          { title: 'Total Invested', dataIndex: 'total_invested', render: (v) => formatCurrency(v) },
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

                  {fiscalYearReports.includes(reportType) && (
                    <Col xs={24} md={4}>
                      <Select
                        placeholder="Fiscal Year"
                        style={{ width: '100%' }}
                        allowClear
                        onChange={(v) => setFiscalYear(v || '')}
                        options={[
                          { value: '2023/2024', label: '2023/2024' },
                          { value: '2024/2025', label: '2024/2025' },
                          { value: '2025/2026', label: '2025/2026' },
                        ]}
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
                <Card size="small"
                  title={`${allReportTypes.find(r => r.value === reportType)?.label || 'Report'} (${summary.total || data.length} records)`}>
                  <Table dataSource={data} columns={getColumns()}
                    rowKey={(r) => r.id || r.shareholder_id || r.date || Math.random()}
                    size="small" scroll={{ x: 900 }}
                    pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100],
                      showTotal: (t) => `Total ${t} records` }}
                  />
                </Card>
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
                <div>
                  <Card size="small" style={{ marginBottom: 16 }}>
                    <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 4 }}
                      title={<><UserOutlined /> {statement.shareholder?.first_name} {statement.shareholder?.middle_name || ''} {statement.shareholder?.last_name}</>}>
                      <Descriptions.Item label="Account No">{statement.shareholder?.account_no}</Descriptions.Item>
                      <Descriptions.Item label="Type">{statement.shareholder?.shareholder_type}</Descriptions.Item>
                      <Descriptions.Item label="Phone">{statement.shareholder?.phone}</Descriptions.Item>
                      <Descriptions.Item label="TIN">{statement.shareholder?.tin || '-'}</Descriptions.Item>
                      <Descriptions.Item label="Total Shares">
                        <Text strong style={{ color: '#d32f2f', fontSize: 16 }}>{formatNumber(statement.total_shares)}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="Total Invested">
                        <Text strong style={{ color: '#52c41a', fontSize: 16 }}>{formatCurrency(statement.total_invested)}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="Status">
                        <Tag color={statement.shareholder?.status === 'active' ? 'green' : 'red'}>
                          {statement.shareholder?.status}
                        </Tag>
                      </Descriptions.Item>
                      {statement.allocations?.length > 0 && (() => {
                        const totalPaid = statement.allocations.reduce((s, a) => s + (a.paid_shares || 0), 0);
                        const totalUnpaid = statement.allocations.reduce((s, a) => s + (a.unpaid_shares || 0), 0);
                        const totalBlocked = statement.allocations.reduce((s, a) => s + (a.paid_blocked || 0) + (a.unpaid_blocked || 0), 0);
                        return (
                          <>
                            <Descriptions.Item label="Paid Shares"><Tag color="blue">{formatNumber(totalPaid)}</Tag></Descriptions.Item>
                            <Descriptions.Item label="Unpaid Shares"><Tag color="orange">{formatNumber(totalUnpaid)}</Tag></Descriptions.Item>
                            <Descriptions.Item label="Total Blocked"><Tag color="red">{formatNumber(totalBlocked)}</Tag></Descriptions.Item>
                          </>
                        );
                      })()}
                    </Descriptions>
                  </Card>

                  {/* Investments */}
                  <Card size="small" title={`Investments (${statement.investments?.length || 0})`} style={{ marginBottom: 12 }}>
                    <Table dataSource={statement.investments || []} rowKey="id" size="small" pagination={false}
                      columns={[
                        { title: 'Date', dataIndex: 'payment_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
                        { title: 'Amount', dataIndex: 'amount', render: (v) => formatCurrency(v) },
                        { title: 'Shares', dataIndex: 'number_of_shares', render: (v) => formatNumber(v) },
                        { title: 'Par Value', dataIndex: 'par_value', render: (v) => formatCurrency(v) },
                        { title: 'Method', dataIndex: 'payment_method' },
                        { title: 'Reference', dataIndex: 'reference_no' },
                        { title: 'Status', dataIndex: 'approval_status', render: (s) => <Tag color={s === 'approved' ? 'green' : 'orange'}>{s}</Tag> },
                      ]}
                    />
                  </Card>

                  {/* Subscriptions */}
                  {statement.subscriptions?.length > 0 && (
                    <Card size="small" title={`Subscriptions (${statement.subscriptions.length})`} style={{ marginBottom: 12 }}>
                      <Table dataSource={statement.subscriptions} rowKey="id" size="small" pagination={false}
                        columns={[
                          { title: 'Shares', dataIndex: 'number_of_shares' },
                          { title: 'Amount', dataIndex: 'share_amount', render: (v) => formatCurrency(v) },
                          { title: 'Expiry', dataIndex: 'expiry_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
                          { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'active' ? 'green' : s === 'extended' ? 'blue' : 'red'}>{s}</Tag> },
                        ]}
                      />
                    </Card>
                  )}

                  {/* Dividends */}
                  <Card size="small" title={`Dividends (${statement.dividends?.length || 0})`} style={{ marginBottom: 12 }}>
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
                  </Card>

                  {/* Allocations */}
                  {statement.allocations?.length > 0 && (
                    <Card size="small" title={`Allocations (${statement.allocations.length})`} style={{ marginBottom: 12 }}>
                      <Table dataSource={statement.allocations} rowKey="id" size="small" pagination={false}
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
                    </Card>
                  )}

                  {/* Transfers */}
                  {statement.transfers?.length > 0 && (
                    <Card size="small" title={`Transfers (${statement.transfers.length})`} style={{ marginBottom: 12 }}>
                      <Table dataSource={statement.transfers} rowKey="id" size="small" pagination={false}
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
                    </Card>
                  )}

                  {/* Blocks */}
                  {statement.blocks?.length > 0 && (
                    <Card size="small" title={`Share Blocks (${statement.blocks.length})`} style={{ marginBottom: 12 }}>
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
                    </Card>
                  )}
                </div>
              )}
            </>
          ),
        },
      ]} />
    </div>
  );
}
