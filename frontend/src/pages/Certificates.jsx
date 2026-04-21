import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, DatePicker, Select,
  Space, Tag, message, Typography, Row, Col, Radio, Card,
  Statistic, Divider, Popconfirm,
} from 'antd';
import {
  PlusOutlined, PrinterOutlined, EyeOutlined,
  FileProtectOutlined, ApartmentOutlined, TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getCertificates, getCertificate, getNextCertNo, createCertificate,
  printCertificate, updateCertificate,
  searchShareholders, getShareholders, getShareholderInvestmentSummary, getBankCapital,
} from '../services/api';
import { formatCurrency } from '../utils/format';

const { Title, Text } = Typography;

// ── helpers ────────────────────────────────────────────────────────────────
function numberToWords(num) {
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven',
    'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
    'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function cvt(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + cvt(n % 100) : '');
    if (n < 1e6) return cvt(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + cvt(n % 1000) : '');
    if (n < 1e9) return cvt(Math.floor(n / 1e6)) + ' Million' + (n % 1e6 ? ' ' + cvt(n % 1e6) : '');
    return cvt(Math.floor(n / 1e9)) + ' Billion' + (n % 1e9 ? ' ' + cvt(n % 1e9) : '');
  }
  return cvt(Math.round(num));
}

// ── certificate HTML for print ─────────────────────────────────────────────
function buildCertHTML(cert) {
  const sh = cert.shareholder || {};
  const alloc = cert.allocation || null;
  const name = [sh.first_name, sh.middle_name, sh.last_name].filter(Boolean).join(' ') || 'N/A';
  const nameAm = [sh.first_name_am, sh.middle_name_am, sh.last_name_am].filter(Boolean).join(' ');
  const shares = cert.number_of_shares || 0;
  const parVal = cert.par_value || 0;
  const totalVal = shares * parVal;
  const issueDate = cert.issue_date
    ? dayjs(cert.issue_date).format('MMMM D, YYYY')
    : dayjs().format('MMMM D, YYYY');
  const isPer = cert.cert_scope === 'per_allocation';
  const scopeNote = isPer
    ? `Allocation No: <strong>${alloc?.allocation_no || '—'}</strong> &nbsp;|&nbsp; Round ${alloc?.round || '—'}`
    : `Total Holdings Certificate — covering all approved allocations`;

  return `<!DOCTYPE html>
<html>
<head>
  <title>Share Certificate — ${cert.certificate_no}</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Georgia','Times New Roman',serif; background:#fff; }
    .cert {
      width:960px; min-height:620px; margin:15px auto;
      border:4px solid #1a3a5c; position:relative;
      background:linear-gradient(135deg,#fffef8 0%,#fdf9ee 100%);
    }
    .inner  { position:absolute;top:8px;left:8px;right:8px;bottom:8px;border:2px solid #b8860b; }
    .deco   { position:absolute;top:14px;left:14px;right:14px;bottom:14px;border:1px solid #d4af37; }
    .corner { position:absolute;width:32px;height:32px;border-color:#b8860b; }
    .ctlr   { top:18px;left:18px;border-top:3px solid;border-left:3px solid; }
    .ctrr   { top:18px;right:18px;border-top:3px solid;border-right:3px solid; }
    .cblr   { bottom:18px;left:18px;border-bottom:3px solid;border-left:3px solid; }
    .cbrr   { bottom:18px;right:18px;border-bottom:3px solid;border-right:3px solid; }
    .watermark {
      position:absolute;top:50%;left:50%;
      transform:translate(-50%,-50%) rotate(-30deg);
      font-size:90px;color:rgba(26,58,92,0.04);font-weight:bold;
      letter-spacing:10px;white-space:nowrap;z-index:0;
    }
    .wrap { position:relative;z-index:1;padding:36px 52px 28px; }
    /* header */
    .header { text-align:center;margin-bottom:10px; }
    .bname  { font-size:30px;font-weight:bold;color:#1a3a5c;letter-spacing:4px;text-transform:uppercase; }
    .bname-am { font-size:17px;color:#1a3a5c;margin-top:2px; }
    .bsub   { font-size:11px;color:#888;letter-spacing:2px;margin-top:3px; }
    /* title bar */
    .cert-title {
      font-size:22px;font-weight:bold;color:#b8860b;text-align:center;
      letter-spacing:6px;text-transform:uppercase;
      border-top:1px solid #d4af37;border-bottom:1px solid #d4af37;
      padding:8px 0;margin:12px 0 6px;
    }
    .cert-no    { text-align:center;font-size:13px;color:#666;margin-bottom:4px; }
    .scope-note { text-align:center;font-size:11px;color:#888;margin-bottom:14px; }
    /* body */
    .main-text { font-size:15px;line-height:2.0;text-align:center;color:#333; }
    .hl   { font-weight:bold;color:#1a3a5c;font-size:17px; }
    .sbox { display:inline-block;border-bottom:2px solid #1a3a5c;padding:0 16px;font-size:22px;font-weight:bold;color:#1a3a5c; }
    /* details row */
    .details { display:flex;justify-content:space-around;margin:18px 0 14px;border-top:1px dashed #ccc;padding-top:14px; }
    .di-label { font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1px; }
    .di-val   { font-size:15px;font-weight:bold;color:#1a3a5c;margin-top:2px; }
    /* allocation box (per-allocation only) */
    .alloc-box {
      border:1px solid #d4af37;background:rgba(212,175,55,0.06);
      border-radius:4px;padding:8px 20px;margin:10px 40px;text-align:center;font-size:12px;color:#7a5f00;
    }
    /* signatures */
    .sigs { display:flex;justify-content:space-between;margin-top:22px;padding:0 40px; }
    .sig  { text-align:center;width:200px; }
    .sig-line { border-top:1px solid #333;margin-top:44px;padding-top:5px; }
    .sig-title{ font-size:11px;color:#666; }
    /* remark */
    .remark { text-align:center;font-size:11px;color:#999;margin-top:10px;font-style:italic; }
    @media print {
      body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      .cert{margin:0;box-shadow:none;}
    }
  </style>
</head>
<body>
<div class="cert">
  <div class="inner"></div><div class="deco"></div>
  <div class="corner ctlr"></div><div class="corner ctrr"></div>
  <div class="corner cblr"></div><div class="corner cbrr"></div>
  <div class="watermark">ZEMEN BANK</div>
  <div class="wrap">
    <div class="header">
      <div class="bname">ZEMEN BANK S.C.</div>
      <div class="bname-am">ዘመን ባንክ አ.ማ.</div>
      <div class="bsub">SHARE MANAGEMENT SYSTEM</div>
    </div>

    <div class="cert-title">${isPer ? 'Allocation Share Certificate' : 'Share Certificate'}</div>
    <div class="cert-no">Certificate No: <strong>${cert.certificate_no}</strong></div>
    <div class="scope-note">${scopeNote}</div>

    <div class="main-text">
      This is to certify that<br/>
      <span class="hl">${name}</span>
      ${nameAm ? `<br/><span style="font-size:14px;color:#555">${nameAm}</span>` : ''}
      <br/>Account No: <strong>${sh.account_no || 'N/A'}</strong>
      <br/>is the registered holder of<br/>
      <span class="sbox">${shares.toLocaleString()}</span><br/>
      <span style="font-size:12px;color:#888">(${numberToWords(shares)} Shares)</span><br/>
      ordinary shares of <strong>Birr ${parVal.toLocaleString()}</strong> each, fully paid, in<br/>
      <strong>ZEMEN BANK S.C.</strong>
    </div>

    ${isPer && alloc ? `
    <div class="alloc-box">
      Allocation: <strong>${alloc.allocation_no}</strong> &nbsp;&bull;&nbsp;
      Round <strong>${alloc.round}</strong> &nbsp;&bull;&nbsp;
      ${alloc.allocation_date ? `Date: ${dayjs(alloc.allocation_date).format('YYYY-MM-DD')}` : ''}
      ${alloc.subscription?.type ? ` &nbsp;&bull;&nbsp; Type: ${alloc.subscription.type}` : ''}
    </div>` : ''}

    <div class="details">
      <div><div class="di-label">Total Value</div><div class="di-val">ETB ${totalVal.toLocaleString()}</div></div>
      <div><div class="di-label">Par Value / Share</div><div class="di-val">ETB ${parVal.toLocaleString()}</div></div>
      <div><div class="di-label">Issue Date</div><div class="di-val">${issueDate}</div></div>
      <div><div class="di-label">Certificate Scope</div><div class="di-val">${isPer ? 'Per Allocation' : 'Total Holdings'}</div></div>
    </div>

    ${cert.remark ? `<div class="remark">Remark: ${cert.remark}</div>` : ''}

    <div class="sigs">
      <div class="sig"><div class="sig-line"><div class="sig-title">Board Chairman</div></div></div>
      <div class="sig" style="text-align:center">
        <div style="font-size:11px;color:#999;margin-top:20px">Company Seal</div>
        <div style="width:70px;height:70px;border:2px dashed #ccc;border-radius:50%;margin:5px auto;display:flex;align-items:center;justify-content:center">
          <span style="font-size:9px;color:#ccc">SEAL</span>
        </div>
      </div>
      <div class="sig"><div class="sig-line"><div class="sig-title">CEO / Managing Director</div></div></div>
    </div>
  </div>
</div>
<script>window.onload=function(){window.print();}</script>
</body></html>`;
}

// ── CertPreview: in-app certificate preview card ───────────────────────────
function CertPreview({ cert }) {
  if (!cert) return null;
  const sh = cert.shareholder || {};
  const alloc = cert.allocation || null;
  const name = [sh.first_name, sh.middle_name, sh.last_name].filter(Boolean).join(' ') || 'N/A';
  const nameAm = [sh.first_name_am, sh.middle_name_am, sh.last_name_am].filter(Boolean).join(' ');
  const shares = cert.number_of_shares || 0;
  const parVal = cert.par_value || 0;
  const totalVal = shares * parVal;
  const issueDate = cert.issue_date ? dayjs(cert.issue_date).format('MMMM D, YYYY') : '—';
  const isPer = cert.cert_scope === 'per_allocation';

  return (
    <div style={{
      border: '3px solid #1a3a5c', background: 'linear-gradient(135deg,#fffef8,#fdf9ee)',
      padding: '28px 36px', fontFamily: 'Georgia, serif', position: 'relative', borderRadius: 2,
    }}>
      {/* inner border */}
      <div style={{ position: 'absolute', top: 7, left: 7, right: 7, bottom: 7, border: '1.5px solid #b8860b', pointerEvents: 'none' }} />
      {/* watermark */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%) rotate(-30deg)',
        fontSize: 70, color: 'rgba(26,58,92,0.04)', fontWeight: 'bold',
        letterSpacing: 10, whiteSpace: 'nowrap', zIndex: 0, userSelect: 'none',
      }}>ZEMEN BANK</div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 'bold', color: '#1a3a5c', letterSpacing: 3 }}>ZEMEN BANK S.C.</div>
          <div style={{ fontSize: 14, color: '#1a3a5c' }}>ዘመን ባንክ አ.ማ.</div>
          <div style={{ fontSize: 10, color: '#888', letterSpacing: 2, marginTop: 2 }}>SHARE MANAGEMENT SYSTEM</div>
        </div>

        {/* Title */}
        <div style={{
          textAlign: 'center', fontSize: 16, fontWeight: 'bold', color: '#b8860b',
          letterSpacing: 4, textTransform: 'uppercase',
          borderTop: '1px solid #d4af37', borderBottom: '1px solid #d4af37',
          padding: '7px 0', marginBottom: 8,
        }}>
          {isPer ? 'Allocation Share Certificate' : 'Share Certificate'}
        </div>
        <div style={{ textAlign: 'center', fontSize: 12, color: '#666', marginBottom: 2 }}>
          Certificate No: <strong>{cert.certificate_no}</strong>
          {' '}<Tag color={cert.status === 'active' ? 'green' : 'red'} style={{ marginLeft: 6 }}>{cert.status}</Tag>
        </div>
        {isPer && alloc && (
          <div style={{ textAlign: 'center', fontSize: 11, color: '#888', marginBottom: 12 }}>
            Allocation: <strong>{alloc.allocation_no}</strong> &nbsp;|&nbsp; Round {alloc.round}
          </div>
        )}
        {!isPer && (
          <div style={{ textAlign: 'center', fontSize: 11, color: '#888', marginBottom: 12 }}>
            Total Holdings Certificate — all approved allocations
          </div>
        )}

        {/* Main text */}
        <div style={{ textAlign: 'center', fontSize: 14, lineHeight: 2, color: '#333', margin: '12px 0' }}>
          This is to certify that<br />
          <span style={{ fontWeight: 'bold', color: '#1a3a5c', fontSize: 16 }}>{name}</span>
          {nameAm && <><br /><span style={{ fontSize: 13, color: '#555' }}>{nameAm}</span></>}
          <br />Account No: <strong>{sh.account_no || 'N/A'}</strong>
          <br />is the registered holder of<br />
          <span style={{
            display: 'inline-block', borderBottom: '2px solid #1a3a5c',
            padding: '0 16px', fontSize: 26, fontWeight: 'bold', color: '#1a3a5c',
          }}>{shares.toLocaleString()}</span>
          <br />
          <span style={{ fontSize: 11, color: '#888' }}>({numberToWords(shares)} Shares)</span>
          <br />ordinary shares of <strong>Birr {parVal.toLocaleString()}</strong> each, fully paid, in<br />
          <strong>ZEMEN BANK S.C.</strong>
        </div>

        {/* Allocation detail box */}
        {isPer && alloc && (
          <div style={{
            border: '1px solid #d4af37', background: 'rgba(212,175,55,0.06)',
            borderRadius: 4, padding: '8px 16px', margin: '8px 0', textAlign: 'center', fontSize: 11, color: '#7a5f00',
          }}>
            <Space split="|" size={12}>
              <span>Alloc No: <strong>{alloc.allocation_no}</strong></span>
              <span>Round: <strong>{alloc.round}</strong></span>
              {alloc.allocation_date && <span>Date: <strong>{dayjs(alloc.allocation_date).format('YYYY-MM-DD')}</strong></span>}
              {alloc.subscription?.type && <span>Type: <strong>{alloc.subscription.type}</strong></span>}
            </Space>
          </div>
        )}

        {/* Detail row */}
        <Row gutter={8} style={{ marginTop: 16, borderTop: '1px dashed #ccc', paddingTop: 14 }}>
          {[
            { label: 'Total Value', value: `ETB ${totalVal.toLocaleString()}` },
            { label: 'Par Value / Share', value: `ETB ${parVal.toLocaleString()}` },
            { label: 'Issue Date', value: issueDate },
            { label: 'Printed', value: cert.is_printed ? `Yes — ${cert.printed_at ? dayjs(cert.printed_at).format('YYYY-MM-DD') : ''}` : 'Not yet' },
          ].map(d => (
            <Col span={6} key={d.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>{d.label}</div>
              <div style={{ fontSize: 13, fontWeight: 'bold', color: '#1a3a5c', marginTop: 2 }}>{d.value}</div>
            </Col>
          ))}
        </Row>

        {cert.remark && (
          <div style={{ textAlign: 'center', fontSize: 11, color: '#999', marginTop: 10, fontStyle: 'italic' }}>
            Remark: {cert.remark}
          </div>
        )}

        {/* Signatures */}
        <Row justify="space-between" style={{ marginTop: 24 }}>
          {['Board Chairman', 'CEO / Managing Director'].map(title => (
            <Col key={title} style={{ textAlign: 'center', width: 160 }}>
              <div style={{ borderTop: '1px solid #333', paddingTop: 5, marginTop: 40 }}>
                <div style={{ fontSize: 10, color: '#666' }}>{title}</div>
              </div>
            </Col>
          ))}
          <Col style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#999' }}>Company Seal</div>
            <div style={{
              width: 64, height: 64, border: '2px dashed #ccc', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '4px auto',
            }}>
              <span style={{ fontSize: 8, color: '#ccc' }}>SEAL</span>
            </div>
          </Col>
        </Row>
      </div>
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────
export default function Certificates() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [viewRecord, setViewRecord] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [shareholders, setShareholders] = useState([]);
  const [shareholderMap, setShareholderMap] = useState({});
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [certScope, setCertScope] = useState('total');
  const [form] = Form.useForm();

  // ── data ──
  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getCertificates({ page, page_size: 20 });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load certificates'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page]);

  // ── shareholder search ──
  const loadShareholders = async (list) => {
    setShareholders(list.map(s => ({ value: s.id, label: `${s.account_no} — ${s.first_name} ${s.last_name}` })));
    const m = {}; list.forEach(s => { m[s.id] = s; }); setShareholderMap(prev => ({ ...prev, ...m }));
  };
  const handleSearch = async (val) => {
    if (!val) return;
    try { const r = await searchShareholders(val); loadShareholders(r.data.data || []); } catch { /**/ }
  };
  const handleDropdownOpen = async (open) => {
    if (open && shareholders.length === 0) {
      try { const r = await getShareholders({ page: 1, page_size: 50 }); loadShareholders(r.data.data || []); } catch { /**/ }
    }
  };

  // ── shareholder select → load summary + auto-fill cert no ──
  const handleShareholderChange = async (shId) => {
    if (!shId) { setSummary(null); return; }
    setSummaryLoading(true);
    form.setFieldsValue({ allocation_id: undefined });
    try {
      const [sumRes, bcRes, noRes] = await Promise.all([
        getShareholderInvestmentSummary(shId),
        getBankCapital(),
        getNextCertNo(),
      ]);
      const s = sumRes.data;
      const parVal = bcRes.data.data?.par_value_per_share || 1000;
      setSummary({ ...s, par_value: parVal });
      form.setFieldsValue({ certificate_no: noRes.data.cert_no, par_value: parVal });
    } catch { /**/ }
    setSummaryLoading(false);
  };

  // ── scope change ──
  const handleScopeChange = (e) => {
    const s = e.target.value;
    setCertScope(s);
    form.setFieldsValue({ allocation_id: undefined });
  };

  // ── submit ──
  const handleSubmit = async (values) => {
    try {
      const payload = {
        shareholder_id: values.shareholder_id,
        certificate_no: values.certificate_no || undefined,
        issue_date: values.issue_date ? values.issue_date.toISOString() : undefined,
        cert_scope: certScope,
        allocation_id: certScope === 'per_allocation' ? values.allocation_id : undefined,
        par_value: values.par_value,
        remark: values.remark || '',
      };
      await createCertificate(payload);
      message.success('Certificate created');
      setModalOpen(false);
      form.resetFields();
      setCertScope('total');
      setSummary(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create certificate');
    }
  };

  // ── open modal ──
  // IMPORTANT: setModalOpen(true) must come FIRST so the Form is rendered
  // before we call setFieldsValue — otherwise the form fields don't exist yet.
  const openModal = () => {
    form.resetFields();
    setCertScope('total');
    setSummary(null);
    setModalOpen(true);
    // Fetch cert no + par value after the modal (and Form) are mounted.
    // Use setTimeout(0) to ensure the Modal + Form have fully rendered first.
    setTimeout(() => {
      Promise.all([getNextCertNo(), getBankCapital()])
        .then(([noRes, bcRes]) => {
          form.setFieldsValue({
            certificate_no: noRes.data.cert_no,
            par_value: bcRes.data.data?.par_value_per_share || 1000,
            issue_date: dayjs(),
          });
        })
        .catch(() => {});
    }, 0);
  };

  // ── view ──
  const handleView = async (record) => {
    setViewLoading(true);
    setViewRecord(null);
    try {
      const res = await getCertificate(record.id);
      setViewRecord(res.data);
    } catch { message.error('Failed to load certificate'); }
    setViewLoading(false);
  };

  // ── print ──
  const handlePrint = async (record) => {
    let cert = record;
    if (!cert.shareholder || !cert.allocation) {
      try { cert = (await getCertificate(record.id)).data; } catch { /**/ }
    }
    await printCertificate(cert.id);
    fetchData();
    const win = window.open('', '_blank', 'width=1000,height=720');
    if (!win) { message.error('Please allow popups to print'); return; }
    win.document.write(buildCertHTML(cert));
    win.document.close();
  };

  // ── cancel certificate ──
  const handleCancel = async (record) => {
    try {
      await updateCertificate(record.id, { status: 'cancelled' });
      message.success('Certificate cancelled');
      fetchData();
    } catch { message.error('Failed to cancel'); }
  };

  // ── scope + allocation summary panel ──
  // Show ALL allocations — no status filter. Backend validates allocation ownership.
  const allocOptions = (summary?.allocations || []).map(a => ({
    value: a.id,
    label: `${a.allocation_no} | Round ${a.round} | ${(a.allocated_shares || 0).toLocaleString()} shares${
      a.approval_status !== 'approved' ? ' [' + a.approval_status + ']' : ''}`,
  }));


  // Reactive watches for the preview field
  const watchParValue = Form.useWatch('par_value', form);
  const watchAllocId = Form.useWatch('allocation_id', form);

  const previewText = (() => {
    if (!summary) return '—';
    const parVal = parseFloat(watchParValue) || summary.par_value || 1000;
    if (certScope === 'total') {
      const sh = summary.total_allocated_shares || 0;
      return `${sh.toLocaleString()} shares = ETB ${(sh * parVal).toLocaleString()}`;
    }
    const a = (summary.allocations || []).find(x => x.id === watchAllocId);
    if (!a) return 'Select an allocation';
    return `${a.allocated_shares.toLocaleString()} shares = ETB ${(a.allocated_shares * parVal).toLocaleString()}`;
  })();

  // ── table columns ──
  const columns = [
    { title: 'Certificate No', dataIndex: 'certificate_no', width: 140 },
    {
      title: 'Shareholder', key: 'sh', width: 180,
      render: (_, r) => r.shareholder
        ? <div><div>{r.shareholder.first_name} {r.shareholder.last_name}</div><Text type="secondary" style={{ fontSize: 11 }}>{r.shareholder.account_no}</Text></div>
        : '—',
    },
    {
      title: 'Scope', dataIndex: 'cert_scope', width: 120,
      render: (s, r) => s === 'per_allocation'
        ? <Space size={2} direction="vertical">
            <Tag icon={<ApartmentOutlined />} color="blue">Per Allocation</Tag>
            {r.allocation && <Text style={{ fontSize: 11 }}>{r.allocation.allocation_no}</Text>}
          </Space>
        : <Tag icon={<TeamOutlined />} color="purple">Total Holdings</Tag>,
    },
    { title: 'Issue Date', dataIndex: 'issue_date', width: 110, render: d => d ? dayjs(d).format('YYYY-MM-DD') : '—' },
    { title: 'Shares', dataIndex: 'number_of_shares', width: 90, render: v => (v || 0).toLocaleString() },
    { title: 'Par Value', dataIndex: 'par_value', width: 100, render: v => formatCurrency(v) },
    { title: 'Total Value', dataIndex: 'total_value', width: 120, render: v => formatCurrency(v) },
    {
      title: 'Printed', key: 'printed', width: 80,
      render: (_, r) => <Tag color={r.is_printed ? 'green' : 'orange'}>{r.is_printed ? 'Yes' : 'No'}</Tag>,
    },
    {
      title: 'Status', dataIndex: 'status', width: 90,
      render: s => <Tag color={s === 'active' ? 'green' : s === 'cancelled' ? 'red' : 'default'}>{s}</Tag>,
    },
    {
      title: 'Actions', key: 'actions', width: 160, fixed: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(r)}>View</Button>
          <Button size="small" icon={<PrinterOutlined />} onClick={() => handlePrint(r)}>
            {r.is_printed ? 'Reprint' : 'Print'}
          </Button>
          {r.status === 'active' && (
            <Popconfirm title="Cancel this certificate?" onConfirm={() => handleCancel(r)} okText="Cancel Cert" okButtonProps={{ danger: true }}>
              <Button size="small" danger>Cancel</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];


  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <FileProtectOutlined style={{ marginRight: 8 }} />Share Certificates
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openModal}>
          Issue Certificate
        </Button>
      </Row>

      <Table
        dataSource={data} columns={columns} rowKey="id"
        loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
        scroll={{ x: 1200 }}
      />

      {/* ── Issue Certificate Modal ── */}
      <Modal
        title={<Space><FileProtectOutlined />Issue New Certificate</Space>}
        open={modalOpen} onCancel={() => { setModalOpen(false); setSummary(null); }}
        footer={null} width={680}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>

          {/* Shareholder */}
          <Form.Item name="shareholder_id" label="Shareholder" rules={[{ required: true, message: 'Select a shareholder' }]}>
            <Select
              showSearch filterOption={false}
              onSearch={handleSearch} onDropdownVisibleChange={handleDropdownOpen}
              onChange={handleShareholderChange}
              options={shareholders} placeholder="Search by name or account…"
              loading={summaryLoading}
            />
          </Form.Item>

          {/* Summary stats */}
          {summary && (
            <Card size="small" style={{ background: '#f0f5ff', borderColor: '#adc6ff', marginBottom: 16 }}>
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic title="Total Allocated Shares" value={summary.total_allocated_shares || 0}
                    suffix="shares" valueStyle={{ fontSize: 16 }} />
                </Col>
                <Col span={8}>
                  <Statistic title="Paid Shares" value={summary.total_shares_paid || 0}
                    suffix="shares" valueStyle={{ fontSize: 16, color: '#52c41a' }} />
                </Col>
                <Col span={8}>
                  <Statistic title="Allocations" value={(summary.allocations || []).length}
                    valueStyle={{ fontSize: 16 }} />
                </Col>
              </Row>
            </Card>
          )}

          {/* Certificate Scope */}
          <Form.Item label="Certificate Scope" required>
            <Radio.Group value={certScope} onChange={handleScopeChange} buttonStyle="solid">
              <Radio.Button value="total">
                <TeamOutlined /> Total Holdings
              </Radio.Button>
              <Radio.Button value="per_allocation">
                <ApartmentOutlined /> Per Allocation
              </Radio.Button>
            </Radio.Group>
            <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
              {certScope === 'total'
                ? 'Certificate covers all approved allocations combined.'
                : 'Certificate covers a single specific allocation.'}
            </div>
          </Form.Item>

          {/* Allocation selector — only for per_allocation */}
          {certScope === 'per_allocation' && (
            <Form.Item name="allocation_id" label="Select Allocation"
              rules={[{ required: true, message: 'Select an allocation' }]}>
              <Select
                placeholder={summary ? 'Choose allocation…' : 'Select a shareholder first'}
                disabled={!summary}
                options={allocOptions}
                optionFilterProp="label"
                showSearch
              />
            </Form.Item>
          )}

          <Divider style={{ margin: '12px 0' }} />

          {/* Certificate number, issue date */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="certificate_no" label="Certificate No"
                tooltip="Auto-generated — you may edit it"
                rules={[{ required: true, message: 'Required' }]}>
                <Input placeholder="e.g. CERT-202603-0001" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="issue_date" label="Issue Date"
                tooltip="Defaults to today">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          {/* Par value + computed total */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="par_value" label="Par Value (Birr / Share)"
                tooltip="Auto-filled from company capital settings"
                rules={[{ required: true, message: 'Required' }]}>
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Shares & Total Value (preview)">
                <Input
                  readOnly
                  value={previewText}
                  style={{ background: '#f6ffed', fontWeight: 500, color: '#1a3a5c' }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="remark" label="Remark (optional)">
            <Input.TextArea rows={2} placeholder="Any remarks to appear on the certificate…" />
          </Form.Item>

          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => { setModalOpen(false); setSummary(null); }}>Cancel</Button>
              <Button type="primary" htmlType="submit" icon={<FileProtectOutlined />}>
                Issue Certificate
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── View Certificate Modal ── */}
      <Modal
        title={viewRecord ? `Certificate — ${viewRecord.certificate_no}` : 'Certificate'}
        open={!!viewRecord || viewLoading}
        onCancel={() => setViewRecord(null)}
        width={780}
        footer={
          viewRecord && (
            <Space>
              <Button onClick={() => setViewRecord(null)}>Close</Button>
              <Button type="primary" icon={<PrinterOutlined />} onClick={() => handlePrint(viewRecord)}>
                {viewRecord.is_printed ? 'Reprint' : 'Print Certificate'}
              </Button>
            </Space>
          )
        }
      >
        {viewLoading && <div style={{ textAlign: 'center', padding: 40 }}>Loading…</div>}
        {viewRecord && <CertPreview cert={viewRecord} />}
      </Modal>
    </div>
  );
}
