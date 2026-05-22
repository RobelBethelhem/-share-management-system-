import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, InputNumber, Space, Tag, Divider,
  message, Typography, Row, Col, Popconfirm, Card, Statistic, Descriptions, Alert,
  Tooltip,
} from 'antd';
import { DollarOutlined, InfoCircleOutlined, RiseOutlined, HistoryOutlined, CalculatorOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getDividends, collectDividend, blockDividend, releaseDividend,
  transferDividend, reinvestDividend, getDividendBreakdown, getDividendHistory,
  getBankCapital,
} from '../services/api';
import { formatCurrency, formatNumber, paymentMethods } from '../utils/format';

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

  useEffect(() => {
    getBankCapital().then(res => setParValue(res.data?.data?.par_value_per_share || 0)).catch(() => {});
  }, []);
  const [form] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [subscribeForm] = Form.useForm();

  // Expanded row cache: { [dividendId]: { breakdown, history } }
  const [expandedCache, setExpandedCache] = useState({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getDividends({ page, page_size: 20, fiscal_year: fiscalYear });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page, fiscalYear]);

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

  const handleCollect = async (values) => {
    try {
      await collectDividend(collectModal.id, values);
      message.success('Dividend collected');
      refreshExpanded(collectModal.id);
      setCollectModal(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
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
    try {
      await transferDividend(transferModal.id, values);
      message.success('Dividend transfer recorded');
      refreshExpanded(transferModal.id);
      setTransferModal(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleSubscribe = async (values) => {
    try {
      const payload = {
        reinvest_amount: Number(values.reinvest_amount ?? 0),
        additional_amount: Number(values.additional_amount ?? 0),
        additional_payment_method: values.additional_payment_method || 'cash',
        from_account: values.from_account || '',
        reference_no: values.reference_no || '',
        remark: values.remark || '',
      };
      await reinvestDividend(subscribeModal.id, payload);
      message.success('Reinvestment recorded — investments created (pending approval).');
      refreshExpanded(subscribeModal.id);
      setSubscribeModal(null);
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
    { title: 'Uncollected', dataIndex: 'uncollected_amount', render: (v) => formatCurrency(v) },
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
        return (
          <Space wrap>
            {reinvestable > 0 && !r.is_blocked && !r.is_transferred && (
              <Button size="small" type="primary" icon={<RiseOutlined />}
                onClick={() => {
                  setSubscribeModal(r);
                  subscribeForm.resetFields();
                  subscribeForm.setFieldsValue({
                    reinvest_amount: Math.max(0, reinvestable),
                    additional_amount: 0,
                    additional_payment_method: 'cash',
                  });
                }}>
                Subscribe
              </Button>
            )}
            {r.uncollected_amount > 0 && !r.is_blocked && !r.is_transferred && (
              <Button size="small" onClick={() => {
                setCollectModal(r);
                form.setFieldsValue({ amount: r.uncollected_amount, payment_method: 'cash' });
              }}>Collect</Button>
            )}
            {r.status !== 'collected' && r.status !== 'transferred' && (
              !r.is_blocked ? (
                <Popconfirm title="Block dividend?" onConfirm={() => handleBlock(r.id)}>
                  <Button size="small" danger>Block</Button>
                </Popconfirm>
              ) : (
                <Button size="small" onClick={() => handleRelease(r.id)}>Release</Button>
              )
            )}
            {r.status !== 'collected' && !r.is_transferred && (
              <Button size="small" onClick={() => { setTransferModal(r); transferForm.resetFields(); }}>Transfer</Button>
            )}
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
          extra={<Text type="secondary">Formula: {b?.formula_label}</Text>}>
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
        <Input placeholder="Filter by fiscal year" style={{ width: 200 }}
          onChange={(e) => setFiscalYear(e.target.value)} allowClear />
      </Row>

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
              <Button type="primary" htmlType="submit">Collect</Button>
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
              <Button type="primary" htmlType="submit">Transfer</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
