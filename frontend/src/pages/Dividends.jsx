import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, InputNumber, Space, Tag,
  message, Typography, Row, Col, Popconfirm, Card, Statistic, Descriptions,
} from 'antd';
import { DollarOutlined, InfoCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getDividends, collectDividend, blockDividend, releaseDividend,
  transferDividend, getShareholderInvestmentSummary,
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
  const [form] = Form.useForm();
  const [transferForm] = Form.useForm();

  // Shareholder summary cache
  const [summaryCache, setSummaryCache] = useState({});

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

  const loadSummary = async (shareholderId) => {
    if (summaryCache[shareholderId]) return;
    try {
      const res = await getShareholderInvestmentSummary(shareholderId);
      setSummaryCache(prev => ({ ...prev, [shareholderId]: res.data }));
    } catch { /* ignore */ }
  };

  const handleCollect = async (values) => {
    try {
      await collectDividend(collectModal.id, values);
      message.success('Dividend collected');
      setCollectModal(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleBlock = async (id) => {
    await blockDividend(id, { reason: 'Blocked by admin' });
    message.success('Blocked');
    fetchData();
  };

  const handleRelease = async (id) => {
    await releaseDividend(id);
    message.success('Released');
    fetchData();
  };

  const handleTransfer = async (values) => {
    try {
      await transferDividend(transferModal.id, values);
      message.success('Dividend transfer recorded');
      setTransferModal(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 50 },
    { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
    { title: 'Fiscal Year', dataIndex: 'fiscal_year', width: 100 },
    { title: 'W.Avg Shares', dataIndex: 'weighted_avg_shares', width: 100, render: v => v?.toFixed(2) },
    { title: 'Gross', dataIndex: 'gross_dividend', render: (v) => formatCurrency(v) },
    { title: 'Tax', dataIndex: 'tax_amount', render: (v) => formatCurrency(v) },
    { title: 'Net', dataIndex: 'net_dividend', render: (v) => formatCurrency(v) },
    { title: 'Collected', dataIndex: 'collected_amount', render: (v) => formatCurrency(v) },
    { title: 'Uncollected', dataIndex: 'uncollected_amount', render: (v) => formatCurrency(v) },
    {
      title: 'Status', key: 'status', width: 100,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Tag color={r.status === 'collected' ? 'green' : r.status === 'partial' ? 'blue' : r.status === 'transferred' ? 'purple' : 'orange'}>{r.status}</Tag>
          {r.is_blocked && <Tag color="red">BLOCKED</Tag>}
          {r.is_transferred && <Tag color="purple">To: {r.transfer_to}</Tag>}
        </Space>
      ),
    },
    {
      title: 'Actions', key: 'actions', width: 200,
      render: (_, r) => (
        <Space wrap>
          {r.uncollected_amount > 0 && !r.is_blocked && !r.is_transferred && (
            <Button size="small" type="primary" onClick={() => {
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
      ),
    },
  ];

  // Expandable row: shareholder share summary (Req 7.8)
  const expandedRowRender = (record) => {
    const summary = summaryCache[record.shareholder_id];
    if (!summary) return <Text type="secondary">Loading...</Text>;
    return (
      <Descriptions bordered size="small" column={4} title={
        <><InfoCircleOutlined /> Share Information Summary</>
      }>
        <Descriptions.Item label="Total Shares">{formatNumber(summary.total_shares)}</Descriptions.Item>
        <Descriptions.Item label="Total Invested">{formatCurrency(summary.total_invested)}</Descriptions.Item>
        <Descriptions.Item label="Subscribed Amount">{formatCurrency(summary.subscribed_amount)}</Descriptions.Item>
        <Descriptions.Item label="Blocked Shares">
          <Text type={summary.blocked_shares > 0 ? 'danger' : undefined}>{summary.blocked_shares || 0}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="Outstanding Balance">{formatCurrency(summary.outstanding_balance)}</Descriptions.Item>
        <Descriptions.Item label="Account No">{record.shareholder?.account_no}</Descriptions.Item>
        <Descriptions.Item label="Type">{record.shareholder?.shareholder_type}</Descriptions.Item>
        <Descriptions.Item label="Investments">{summary.investments?.length || 0} records</Descriptions.Item>
      </Descriptions>
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
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }} scroll={{ x: 1300 }}
        expandable={{
          expandedRowRender,
          onExpand: (expanded, record) => { if (expanded) loadSummary(record.shareholder_id); },
        }}
      />

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
            <Select options={paymentMethods} />
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
