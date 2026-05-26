import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, DatePicker, InputNumber, Select,
  Space, Tag, message, Typography, Row, Col, Card, Popconfirm, Tabs, Tooltip,
  Alert, Divider, Badge,
} from 'antd';
import {
  PlusOutlined, ThunderboltOutlined, EditOutlined, DeleteOutlined,
  InfoCircleOutlined, SettingOutlined, ExperimentOutlined, CheckCircleOutlined,
  WarningOutlined, CodeOutlined, CalculatorOutlined, SaveOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getDividendSettings, createDividendSetting, updateDividendSetting,
  processDividend, deleteDividendSetting, getDPSSummary, getDividendTaxSchedules,
  createDividendTaxBracket, updateDividendTaxBracket, deleteDividendTaxBracket,
  getSystemSetting, updateSystemSetting, testFormula,
} from '../services/api';
import { formatCurrency } from '../utils/format';

const { Title, Text } = Typography;

// ── Share Calculation Formula Templates ──
const SHARE_FORMULA_TEMPLATES = [
  {
    label: 'Weighted Average (Time-based)',
    value: 'shares * days_held / days_in_year',
    description: 'Shares proportional to holding period. Most common for banks.',
  },
  {
    label: 'Snapshot (Record Date)',
    value: 'shares',
    description: 'All shares held at record date qualify equally, regardless of when purchased.',
  },
  {
    label: 'Paid Shares Only (Time-based)',
    value: 'paid_shares * days_held / days_in_year',
    description: 'Only fully paid shares, weighted by time. Excludes partially paid.',
  },
  {
    label: 'Capital / Company Par Value',
    value: '(amount / company_par_value) * days_held / days_in_year',
    description: 'Shares based on paid capital relative to company par value, time-weighted.',
  },
  {
    label: 'Free Shares (Exclude Blocked)',
    value: 'max(0, shares - blocked_shares) * days_held / days_in_year',
    description: 'Excludes blocked/pledged shares from dividend calculation.',
  },
  {
    label: 'Paid-up Capital Ratio',
    value: 'amount / paid_up_capital * total_company_shares * days_held / days_in_year',
    description: 'Proportional to shareholder\'s contribution to total paid-up capital.',
  },
  {
    label: 'Capital Weighted (Time-based)',
    value: 'amount * days_held / days_in_year',
    description: 'Paid-up capital proportional to holding period. Weights by money invested.',
  },
  {
    label: 'Capped at 6 Months',
    value: 'shares * min(days_held, 182) / days_in_year',
    description: 'Time-weighted but capped at 182 days (6 months max benefit).',
  },
];

// ── Tax Formula Templates ──
const TAX_FORMULA_TEMPLATES = [
  { label: 'Ethiopian Progressive (Default)', value: '(amount * rate / 100) - deduction', description: 'Standard Ethiopian income tax with deduction' },
  { label: 'Flat Rate per Bracket', value: 'amount * rate / 100', description: 'Simple percentage, no deduction' },
  { label: 'With Floor (No Negative)', value: 'max(0, (amount * rate / 100) - deduction)', description: 'Progressive but ensures tax is never negative' },
  { label: 'Marginal on Excess', value: '(amount - min) * rate / 100', description: 'Tax only on amount above bracket minimum' },
  { label: 'Flat Rate with Cap', value: 'min(amount * rate / 100, max * 0.3)', description: 'Percentage with maximum cap' },
];

// ── Reusable Formula Editor Component ──
function FormulaEditor({ formulaKey, title, subtitle, templates, variables, defaultTestVars, onSaved }) {
  const [currentFormula, setCurrentFormula] = useState('');
  const [formulaInput, setFormulaInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState('');
  const [testVars, setTestVars] = useState(defaultTestVars);

  const fetchFormula = useCallback(async () => {
    try {
      const res = await getSystemSetting(formulaKey);
      setCurrentFormula(res.data.value || '');
      setFormulaInput(res.data.value || '');
    } catch {
      const def = templates[0]?.value || '';
      setCurrentFormula(def);
      setFormulaInput(def);
    }
  }, [formulaKey, templates]);

  useEffect(() => { fetchFormula(); }, [fetchFormula]);

  const handleTest = async (f) => {
    const formula = f || formulaInput;
    setTestError('');
    setTestResult(null);
    try {
      const res = await testFormula({ formula, vars: testVars });
      setTestResult(res.data.result);
    } catch (err) {
      setTestError(err.response?.data?.error || 'Invalid formula');
    }
  };

  const handleSave = async () => {
    try {
      await testFormula({ formula: formulaInput, vars: testVars });
    } catch (err) {
      message.error('Cannot save - formula has errors: ' + (err.response?.data?.error || 'Invalid'));
      return;
    }
    try {
      await updateSystemSetting(formulaKey, { value: formulaInput });
      setCurrentFormula(formulaInput);
      setEditing(false);
      message.success('Formula saved! Backend will use this formula for processing.');
      onSaved?.();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to save');
    }
  };

  return (
    <>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={0}>
          <Title level={5} style={{ margin: 0 }}>{title}</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>{subtitle}</Text>
        </Space>
      </Row>

      {/* Active Formula Display */}
      <Card size="small" style={{ marginBottom: 16, borderColor: '#52c41a' }}>
        <Row align="middle" justify="space-between">
          <Space>
            <Badge status="success" />
            <Text strong>Active Formula:</Text>
            <Text code style={{ fontSize: 14 }}>{currentFormula}</Text>
          </Space>
          {!editing && (
            <Button icon={<EditOutlined />} onClick={() => { setEditing(true); setFormulaInput(currentFormula); setTestResult(null); setTestError(''); }}>
              Edit Formula
            </Button>
          )}
        </Row>
      </Card>

      {/* Editor */}
      {editing && (
        <Card title="Formula Editor" size="small" style={{ marginBottom: 16 }}
          extra={<Button size="small" onClick={() => setEditing(false)}>Cancel</Button>}>

          {/* Templates */}
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Quick Templates:</Text>
          <Space wrap style={{ marginBottom: 12 }}>
            {templates.map((t, i) => (
              <Tooltip key={i} title={<><Text code>{t.value}</Text><br />{t.description}</>}>
                <Tag
                  color={formulaInput === t.value ? 'blue' : 'default'}
                  style={{ cursor: 'pointer', padding: '4px 8px' }}
                  onClick={() => { setFormulaInput(t.value); setTestResult(null); setTestError(''); }}
                >
                  {t.label}
                </Tag>
              </Tooltip>
            ))}
          </Space>

          <Divider style={{ margin: '8px 0' }} />

          {/* Formula Input */}
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Formula Expression:</Text>
          <Input.TextArea
            value={formulaInput}
            onChange={e => { setFormulaInput(e.target.value); setTestResult(null); setTestError(''); }}
            rows={2}
            style={{ fontFamily: 'monospace', fontSize: 14 }}
          />

          {/* Variables & Functions */}
          <Alert
            message="Available Variables & Functions"
            type="info" showIcon icon={<InfoCircleOutlined />}
            style={{ margin: '12px 0' }}
            description={
              <Row gutter={24}>
                <Col span={12}>
                  <Text strong>Variables:</Text>
                  <ul style={{ margin: '4px 0', paddingLeft: 16, fontSize: 12 }}>
                    {variables.map(v => (
                      <li key={v.name}><Text code>{v.name}</Text> - {v.desc}</li>
                    ))}
                  </ul>
                </Col>
                <Col span={12}>
                  <Text strong>Functions:</Text>
                  <ul style={{ margin: '4px 0', paddingLeft: 16, fontSize: 12 }}>
                    <li><Text code>min(a, b)</Text> - Smaller value</li>
                    <li><Text code>max(a, b)</Text> - Larger value</li>
                    <li><Text code>abs(x)</Text> - Absolute value</li>
                    <li><Text code>round(x)</Text> - Round to 2 decimals</li>
                    <li><Text code>floor(x)</Text> / <Text code>ceil(x)</Text></li>
                  </ul>
                  <Text strong>Operators:</Text> <Text code>+ - * / ( )</Text>
                </Col>
              </Row>
            }
          />

          {/* Test Section */}
          <Card size="small" title={<><ExperimentOutlined /> Test with Sample Values</>} style={{ marginBottom: 12 }}>
            <Row gutter={8} align="bottom" wrap>
              {Object.entries(testVars).map(([key, val]) => (
                <Col key={key} flex="1" style={{ minWidth: 90 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>{key}</Text>
                  <InputNumber size="small" style={{ width: '100%' }} value={val}
                    onChange={v => setTestVars(p => ({ ...p, [key]: v || 0 }))} />
                </Col>
              ))}
              <Col flex="none">
                <Button type="primary" size="small" icon={<ExperimentOutlined />}
                  onClick={() => handleTest()}>Test</Button>
              </Col>
            </Row>

            {testResult !== null && (
              <Alert style={{ marginTop: 8 }} type="success" showIcon icon={<CheckCircleOutlined />}
                message={<span>Result: <Text strong style={{ fontSize: 16 }}>{testResult.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</Text></span>}
              />
            )}
            {testError && (
              <Alert style={{ marginTop: 8 }} type="error" showIcon icon={<WarningOutlined />}
                message="Formula Error" description={testError} />
            )}
          </Card>

          <Row justify="end">
            <Space>
              <Button onClick={() => setEditing(false)}>Cancel</Button>
              <Popconfirm title="Save this formula? It will be used for all future processing."
                onConfirm={handleSave} okText="Yes, Save">
                <Button type="primary" icon={<SaveOutlined />} disabled={formulaInput === currentFormula}>
                  Save Formula
                </Button>
              </Popconfirm>
            </Space>
          </Row>
        </Card>
      )}

      {/* Examples Table */}
      <Card title="Formula Examples" size="small">
        <Table
          dataSource={templates.map((t, i) => ({ ...t, key: i }))}
          columns={[
            { title: 'Name', dataIndex: 'label', width: 220 },
            { title: 'Formula', dataIndex: 'value', render: v => <Text code>{v}</Text> },
            { title: 'Description', dataIndex: 'description' },
            {
              title: '', key: 'action', width: 60,
              render: (_, r) => (
                <Tooltip title="Test this formula">
                  <Button size="small" type="link" icon={<ExperimentOutlined />}
                    onClick={() => {
                      setEditing(true);
                      setFormulaInput(r.value);
                      setTestResult(null);
                      setTestError('');
                      setTimeout(() => handleTest(r.value), 100);
                    }} />
                </Tooltip>
              ),
            },
          ]}
          size="small" pagination={false}
        />
      </Card>
    </>
  );
}

// ── Main Component ──
export default function DividendSettings() {
  const [data, setData] = useState([]);
  const [dpsSummary, setDpsSummary] = useState([]);
  const [taxBrackets, setTaxBrackets] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [taxModalOpen, setTaxModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingTax, setEditingTax] = useState(null);
  const [form] = Form.useForm();
  const [taxForm] = Form.useForm();

  const fetchData = async () => {
    try {
      const [res1, res2, res3] = await Promise.all([
        getDividendSettings(), getDPSSummary(), getDividendTaxSchedules(),
      ]);
      setData(res1.data.data || []);
      setDpsSummary(res2.data.data || []);
      setTaxBrackets(res3.data.data || []);
    } catch {}
  };

  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (values) => {
    try {
      if (values.reference_start_date) values.reference_start_date = values.reference_start_date.toISOString();
      if (values.reference_date) values.reference_date = values.reference_date.toISOString();
      if (values.tax_grace_period) values.tax_grace_period = values.tax_grace_period.toISOString();
      if (editing) {
        await updateDividendSetting(editing.id, values);
        message.success('Updated');
      } else {
        await createDividendSetting(values);
        message.success('Created');
      }
      setModalOpen(false);
      form.resetFields();
      setEditing(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  // When either date changes, recompute Days = (end − start) + 1. Keeps the
  // field editable so the operator can override (e.g., a 366-day leap year
  // or a stub partial year).
  const recomputeDays = () => {
    const start = form.getFieldValue('reference_start_date');
    const end = form.getFieldValue('reference_date');
    if (!start || !end) return;
    const days = end.diff(start, 'day') + 1;
    if (days > 0) form.setFieldValue('days_in_year', days);
  };

  const handleProcess = async (id) => {
    try {
      const res = await processDividend(id);
      message.success(`Processed: ${res.data.shareholders_processed} shareholders, DPS: ${res.data.dividend_per_share?.toFixed(4)}`);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleDeleteSetting = async (id) => {
    try {
      const res = await deleteDividendSetting(id);
      message.success(res.data?.message || 'Fiscal year deleted');
      fetchData();
    } catch (err) {
      // Backend returns 409 with a precise human-readable reason when something
      // (collected / reinvested / blocked / transferred) prevents cascade delete.
      message.error(err.response?.data?.error || 'Failed to delete', 8);
    }
  };

  const handleTaxSubmit = async (values) => {
    try {
      if (editingTax) {
        await updateDividendTaxBracket(editingTax.id, values);
        message.success('Tax bracket updated');
      } else {
        await createDividendTaxBracket(values);
        message.success('Tax bracket created');
      }
      setTaxModalOpen(false);
      taxForm.resetFields();
      setEditingTax(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleDeleteTaxBracket = async (id) => {
    try {
      await deleteDividendTaxBracket(id);
      message.success('Tax bracket deleted');
      fetchData();
    } catch { message.error('Failed to delete'); }
  };

  // ── Tables ──
  const columns = [
    { title: 'Fiscal Year', dataIndex: 'fiscal_year', width: 100 },
    { title: 'Period', key: 'period', width: 220,
      render: (_, r) => {
        const end = r.reference_date ? dayjs(r.reference_date) : null;
        const start = r.reference_start_date ? dayjs(r.reference_start_date) : (end && r.days_in_year ? end.subtract(r.days_in_year - 1, 'day') : null);
        if (!end) return '-';
        return (
          <span style={{ fontSize: 12 }}>
            {start ? start.format('YYYY-MM-DD') : '?'} → {end.format('YYYY-MM-DD')}
          </span>
        );
      }},
    { title: 'Days', dataIndex: 'days_in_year', width: 60 },
    { title: 'Declared Amount', dataIndex: 'declared_amount', render: v => formatCurrency(v) },
    { title: 'DPS', dataIndex: 'dividend_per_share', render: v => v ? v.toFixed(4) : '-' },
    { title: 'Status', dataIndex: 'status', render: s => <Tag color={s === 'processed' ? 'green' : s === 'declared' ? 'blue' : 'default'}>{s}</Tag> },
    {
      title: 'Actions', key: 'actions', width: 240,
      render: (_, r) => (
        <Space>
          {!r.is_processed && (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => {
                setEditing(r);
                form.setFieldsValue({
                  ...r,
                  reference_start_date: r.reference_start_date ? dayjs(r.reference_start_date) : null,
                  reference_date: r.reference_date ? dayjs(r.reference_date) : null,
                  tax_grace_period: r.tax_grace_period ? dayjs(r.tax_grace_period) : null,
                });
                setModalOpen(true);
              }}>Edit</Button>
              <Popconfirm title="Process this dividend? This cannot be undone." onConfirm={() => handleProcess(r.id)}>
                <Button size="small" type="primary" icon={<ThunderboltOutlined />}>Process</Button>
              </Popconfirm>
            </>
          )}
          <Popconfirm
            title={`Delete fiscal year ${r.fiscal_year}?`}
            description={
              <div style={{ maxWidth: 320 }}>
                This removes the fiscal-year setting <strong>and every per-shareholder dividend it produced</strong>, plus their action history.
                Blocked if any dividend has already been collected as cash or reinvested into investments — reverse those first.
              </div>
            }
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDeleteSetting(r.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>Delete</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const dpsColumns = [
    { title: 'Fiscal Year', dataIndex: 'fiscal_year' },
    { title: 'Declared', dataIndex: 'declared_amount', render: v => formatCurrency(v) },
    { title: 'DPS', dataIndex: 'dividend_per_share', render: v => v?.toFixed(4) },
    { title: 'Total Dividend', dataIndex: 'total_dividend', render: v => formatCurrency(v) },
    { title: 'Total Tax', dataIndex: 'total_tax', render: v => formatCurrency(v) },
    { title: 'Collected', dataIndex: 'total_collected', render: v => formatCurrency(v) },
    { title: 'Uncollected', dataIndex: 'total_uncollected', render: v => formatCurrency(v) },
    { title: 'Shareholders', dataIndex: 'shareholders' },
  ];

  const taxColumns = [
    { title: '#', key: 'idx', width: 40, render: (_, __, i) => i + 1 },
    { title: 'Income Range (ETB)', key: 'range', render: (_, r) => `${r.min_amount.toLocaleString()} - ${r.max_amount.toLocaleString()}` },
    { title: 'Tax Rate (%)', dataIndex: 'tax_rate', width: 100, render: v => `${v}%` },
    { title: 'Deduction (ETB)', dataIndex: 'deduction', width: 130, render: v => v.toLocaleString() },
    { title: 'Description', dataIndex: 'description' },
    {
      title: 'Actions', key: 'actions', width: 120,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => {
            setEditingTax(r);
            taxForm.setFieldsValue(r);
            setTaxModalOpen(true);
          }} />
          <Popconfirm title="Delete this tax bracket?" onConfirm={() => handleDeleteTaxBracket(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const tabItems = [
    {
      key: 'settings',
      label: 'Dividend Settings',
      children: (
        <>
          <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
            <Title level={5} style={{ margin: 0 }}>Fiscal Year Settings</Title>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => {
              setEditing(null);
              form.resetFields();
              // Suggest the day AFTER the most-recent existing fiscal year's
              // reference_date as the new period's start. Avoids the operator
              // accidentally double-counting the same year.
              let suggestedStart = null;
              if (data.length > 0) {
                const latest = [...data]
                  .filter(d => d.reference_date)
                  .sort((a, b) => dayjs(b.reference_date).valueOf() - dayjs(a.reference_date).valueOf())[0];
                if (latest?.reference_date) {
                  suggestedStart = dayjs(latest.reference_date).add(1, 'day');
                }
              }
              form.setFieldsValue({
                days_in_year: 365,
                reference_start_date: suggestedStart,
              });
              setModalOpen(true);
            }}>
              New Fiscal Year
            </Button>
          </Row>
          <Alert
            message="How Dividend Processing Works"
            type="info" showIcon
            style={{ marginBottom: 16 }}
            description={
              <Text style={{ fontSize: 12 }}>
                1. For each shareholder's investments, the <Text strong>Share Calculation Formula</Text> is applied per investment and summed.{' '}
                2. DPS = Declared Amount / Total Calculated Shares.{' '}
                3. Gross Dividend = Shareholder's Shares x DPS.{' '}
                4. Tax is computed using the <Text strong>Tax Formula</Text> with the matching bracket.{' '}
                Configure both formulas in their respective tabs.
              </Text>
            }
          />
          <Table dataSource={data} columns={columns} rowKey="id" size="small" pagination={false} />
          {dpsSummary.length > 0 && (
            <Card title="DPS Summary Table" style={{ marginTop: 24 }} size="small">
              <Table dataSource={dpsSummary} columns={dpsColumns} rowKey="fiscal_year" size="small" pagination={false} />
            </Card>
          )}
        </>
      ),
    },
    {
      key: 'share-formula',
      label: (<span><CalculatorOutlined /> Share Calculation</span>),
      children: (
        <FormulaEditor
          formulaKey="share_calc_formula"
          title="Share Calculation Formula"
          subtitle="Defines how each investment's eligible shares are calculated. Applied per investment, then summed for each shareholder."
          templates={SHARE_FORMULA_TEMPLATES}
          variables={[
            { name: 'shares', desc: 'Number of shares in this investment' },
            { name: 'amount', desc: 'Paid-up capital (ETB) of this investment' },
            { name: 'days_held', desc: 'Days held (payment date to reference date)' },
            { name: 'days_in_year', desc: 'Days in fiscal year (default 365)' },
            { name: 'par_value', desc: 'Par value per share (amount / shares)' },
            { name: 'premium', desc: 'Premium value of this investment' },
            { name: 'total_shares', desc: 'Total shares across all investments (shareholder)' },
            { name: 'total_paid', desc: 'Total paid amount across all investments (shareholder)' },
            { name: 'paid_shares', desc: 'Shares from fully paid investments (shareholder)' },
            { name: 'blocked_shares', desc: 'Currently blocked/pledged shares (shareholder)' },
            { name: 'free_shares', desc: 'Unblocked shares = total_shares - blocked_shares' },
            { name: 'subscription_shares', desc: 'Subscribed shares (shareholder)' },
            { name: 'paid_up_capital', desc: 'Company total paid-up capital' },
            { name: 'authorized_capital', desc: 'Company authorized capital' },
            { name: 'company_par_value', desc: 'Company par value per share' },
            { name: 'total_company_shares', desc: 'Total company shares' },
          ]}
          defaultTestVars={{ shares: 100, amount: 100000, days_held: 200, days_in_year: 365, par_value: 1000, premium: 0, total_shares: 500, total_paid: 500000, paid_shares: 400, blocked_shares: 50, free_shares: 450, subscription_shares: 600, paid_up_capital: 5000000, authorized_capital: 10000000, company_par_value: 1000, total_company_shares: 10000 }}
        />
      ),
    },
    {
      key: 'tax',
      label: (<span><SettingOutlined /> Tax Brackets</span>),
      children: (
        <>
          <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
            <Space direction="vertical" size={0}>
              <Title level={5} style={{ margin: 0 }}>Dividend Income Tax Brackets</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Income tax schedule applied to dividend payments. Modify when government updates tax rates.
              </Text>
            </Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => {
              setEditingTax(null);
              taxForm.resetFields();
              setTaxModalOpen(true);
            }}>
              Add Bracket
            </Button>
          </Row>
          <Table dataSource={taxBrackets} columns={taxColumns} rowKey="id" size="small" pagination={false} />
        </>
      ),
    },
    {
      key: 'tax-formula',
      label: (<span><CodeOutlined /> Tax Formula</span>),
      children: (
        <FormulaEditor
          formulaKey="tax_formula"
          title="Tax Calculation Formula"
          subtitle="Defines how dividend tax is computed from the matching bracket. Applied to each shareholder's gross dividend."
          templates={TAX_FORMULA_TEMPLATES}
          variables={[
            { name: 'amount', desc: 'Gross dividend amount' },
            { name: 'rate', desc: 'Tax rate (%) from matching bracket' },
            { name: 'deduction', desc: 'Deduction amount from matching bracket' },
            { name: 'min', desc: 'Bracket minimum amount' },
            { name: 'max', desc: 'Bracket maximum amount' },
          ]}
          defaultTestVars={{ amount: 5000, rate: 20, deduction: 302.5, min: 3201, max: 5250 }}
        />
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>Dividend Configuration</Title>
      <Tabs items={tabItems} defaultActiveKey="settings" />

      {/* Dividend Setting Modal */}
      <Modal title={editing ? 'Edit Dividend Setting' : 'New Fiscal Year'} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} width={600}>
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ days_in_year: 365 }}>
          <Form.Item name="fiscal_year" label="Fiscal Year" rules={[{ required: true }]}>
            <Input placeholder="e.g. 2023/2024" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="reference_start_date" label="Period Start (inclusive)"
                tooltip="The first day of this dividend's earning period. Used for overlap detection against other fiscal years."
                rules={[{ required: true, message: 'Pick the period start date' }]}>
                <DatePicker style={{ width: '100%' }} onChange={recomputeDays} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="reference_date" label="Reference Date (end, inclusive)"
                tooltip="Cut-off date for share calculations — the last day of this dividend's earning period."
                rules={[{ required: true, message: 'Pick the reference (end) date' }]}>
                <DatePicker style={{ width: '100%' }} onChange={recomputeDays} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="days_in_year" label="Days in Period"
                tooltip="Auto-computed from start → end (inclusive). Editable — set 366 for a leap year or override for a stub partial year.">
                <InputNumber style={{ width: '100%' }} min={1} max={400} />
              </Form.Item>
            </Col>
          </Row>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Period validation"
            description="Two fiscal years cannot cover overlapping days. The system suggests starting the day after the most recent year ended; you can adjust if needed."
          />
          <Form.Item name="declared_amount" label="Declared Dividend Amount (Total Pool)" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} />
          </Form.Item>
          <Form.Item name="tax_grace_period" label="Tax Grace Period Expiry">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Alert
            message="Formulas Used During Processing"
            type="info" showIcon
            style={{ marginBottom: 16 }}
            description={
              <Text style={{ fontSize: 12 }}>
                Share calculation and tax formulas are configured globally in the{' '}
                <Text strong>"Share Calculation"</Text> and <Text strong>"Tax Formula"</Text> tabs.
                Change them before processing if needed.
              </Text>
            }
          />
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">{editing ? 'Update' : 'Create'}</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Tax Bracket Modal */}
      <Modal title={editingTax ? 'Edit Tax Bracket' : 'Add Tax Bracket'} open={taxModalOpen}
        onCancel={() => { setTaxModalOpen(false); setEditingTax(null); }} footer={null} width={500}>
        <Form form={taxForm} layout="vertical" onFinish={handleTaxSubmit}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="min_amount" label="Min Amount (ETB)" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="max_amount" label="Max Amount (ETB)" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="tax_rate" label="Tax Rate (%)" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} max={100} precision={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="deduction" label="Deduction (ETB)" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="Description">
            <Input placeholder="e.g. Exempt, 10%, 15%, etc." />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => { setTaxModalOpen(false); setEditingTax(null); }}>Cancel</Button>
              <Button type="primary" htmlType="submit">{editingTax ? 'Update' : 'Add'}</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
