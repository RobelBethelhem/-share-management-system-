import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Space, Tag,
  message, Typography, Row, Descriptions, Statistic, Card, Divider, Spin, Col,
} from 'antd';
import {
  CheckOutlined, CloseOutlined, ShopOutlined, DollarOutlined, TeamOutlined,
  UserOutlined, CalendarOutlined, SwapOutlined, FileTextOutlined, LockOutlined,
  BankOutlined, RiseOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { getApprovals, approveItem, rejectItem } from '../services/api';
import api from '../services/api';

const { Title, Text } = Typography;

const TYPE_COLORS = {
  investment: 'blue', transfer: 'purple', subscription: 'green',
  block: 'red', dividend: 'orange', trade_request: 'magenta', proxy: 'cyan',
  capital_increase: 'gold',
};
const TYPE_LABELS = {
  investment: 'INVESTMENT', transfer: 'TRANSFER', subscription: 'SUBSCRIPTION',
  block: 'SHARE BLOCK', dividend: 'DIVIDEND', trade_request: 'MARKETPLACE TRADE', proxy: 'AGM PROXY',
  capital_increase: 'CAPITAL INCREASE',
};
const TYPE_ICONS = {
  investment: <BankOutlined />, transfer: <SwapOutlined />, subscription: <FileTextOutlined />,
  block: <LockOutlined />, dividend: <DollarOutlined />, trade_request: <ShopOutlined />, proxy: <TeamOutlined />,
  capital_increase: <RiseOutlined />,
};

const formatETB = (v) => `ETB ${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const formatN = (v) => Number(v || 0).toLocaleString('en-US');
const fmtDate = (d) => (d ? dayjs(d).format('YYYY-MM-DD') : '-');
const fmtDateTime = (d) => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '-');
const fullName = (sh) => sh ? `${sh.first_name || ''} ${sh.middle_name || ''} ${sh.last_name || ''}`.replace(/\s+/g, ' ').trim() : '-';

export default function Approvals() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [rejectModal, setRejectModal] = useState(null);
  const [form] = Form.useForm();

  // Single review modal state for all entity types: {approval, detail, extras}.
  // Loading flag set per-row so the button on the row being reviewed shows a spinner.
  const [reviewLoadingId, setReviewLoadingId] = useState(null);
  const [reviewItem, setReviewItem] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getApprovals({ page, page_size: 20, entity_type: entityType, status: 'pending' });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page, entityType]);

  // Fetches the entity detail for the review modal. Returns {detail, extras}.
  const fetchDetailFor = async (record) => {
    const id = record.entity_id;
    switch (record.entity_type) {
      case 'investment':
        return { detail: (await api.get(`/investments/${id}`)).data };
      case 'transfer':
        return { detail: (await api.get(`/transfers/${id}`)).data };
      case 'subscription':
        return { detail: (await api.get(`/subscriptions/${id}`)).data };
      case 'block':
        return { detail: (await api.get(`/share-blocks/${id}`)).data };
      case 'dividend':
        return { detail: (await api.get(`/dividends/${id}`)).data };
      case 'capital_increase': {
        const r = await api.get(`/capital-increases/${id}`);
        return { detail: r.data.data, extras: { remaining: r.data.remaining } };
      }
      case 'trade_request': {
        const r = await api.get(`/marketplace/trades/${id}`);
        return { detail: r.data.data, extras: { fees: r.data.fees } };
      }
      case 'proxy': {
        const r = await api.get(`/agm/proxy/${id}`);
        return {
          detail: r.data.data,
          extras: {
            meeting: r.data.meeting,
            investments: r.data.investments,
            shares: r.data.shares,
            total_paid: r.data.total_paid,
            transfer_count: r.data.transfer_count,
          },
        };
      }
      default:
        return null;
    }
  };

  const openReview = async (record) => {
    setReviewLoadingId(record.id);
    try {
      const r = await fetchDetailFor(record);
      if (!r) {
        message.error(`No detail view defined for ${record.entity_type}`);
        return;
      }
      setReviewItem({ approval: record, detail: r.detail, extras: r.extras || {} });
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to load details');
    } finally {
      setReviewLoadingId(null);
    }
  };

  const handleApproveFromReview = async () => {
    if (!reviewItem) return;
    try {
      await approveItem(reviewItem.approval.id);
      message.success('Approved');
      setReviewItem(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleReject = async (values) => {
    try {
      await rejectItem(rejectModal.id, values);
      message.success('Rejected');
      setRejectModal(null);
      fetchData();
    } catch (err) { message.error(err.response?.data?.error || 'Failed'); }
  };

  // Open the reject modal from inside the review modal (preserves the approvalId)
  const rejectFromReview = () => {
    setRejectModal({ id: reviewItem.approval.id });
    setReviewItem(null);
    form.resetFields();
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 50 },
    {
      title: 'Type', dataIndex: 'entity_type', width: 180,
      render: (t) => (
        <Tag color={TYPE_COLORS[t] || 'default'} icon={TYPE_ICONS[t]}>
          {' '}{TYPE_LABELS[t] || t?.toUpperCase()}
        </Tag>
      ),
    },
    { title: 'Entity ID', dataIndex: 'entity_id', width: 80 },
    { title: 'Action', dataIndex: 'action', width: 80, render: (a) => <Tag>{a}</Tag> },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'pending' ? 'orange' : s === 'approved' ? 'green' : 'red'}>{s}</Tag> },
    { title: 'Requested', dataIndex: 'requested_at', render: fmtDateTime },
    {
      title: 'Actions', key: 'actions', width: 240,
      render: (_, r) => r.status === 'pending' && (
        <Space>
          <Button size="small" type="primary" icon={<CheckOutlined />}
            onClick={() => openReview(r)}
            loading={reviewLoadingId === r.id}>
            Review &amp; Approve
          </Button>
          <Button size="small" danger icon={<CloseOutlined />}
            onClick={() => { setRejectModal(r); form.resetFields(); }}>
            Reject
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Authorization &amp; Rejection</Title>
        <Select placeholder="Filter by type" allowClear style={{ width: 200 }}
          onChange={(v) => { setEntityType(v || ''); setPage(1); }}
          options={[
            { value: 'investment', label: 'Investment' },
            { value: 'transfer', label: 'Transfer' },
            { value: 'subscription', label: 'Subscription' },
            { value: 'block', label: 'Share Block' },
            { value: 'dividend', label: 'Dividend' },
            { value: 'capital_increase', label: 'Capital Increase' },
            { value: 'trade_request', label: 'Marketplace Trade' },
            { value: 'proxy', label: 'AGM Proxy' },
          ]}
        />
      </Row>

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }} />

      {/* Unified Review & Approve modal — one modal, body switches by entity type */}
      <Modal
        title={
          reviewItem ? (
            <Space>
              {TYPE_ICONS[reviewItem.approval.entity_type]}
              {`Review ${TYPE_LABELS[reviewItem.approval.entity_type] || ''} #${reviewItem.approval.entity_id}`}
            </Space>
          ) : ''
        }
        open={!!reviewItem}
        onCancel={() => setReviewItem(null)}
        width={760}
        destroyOnClose
        footer={reviewItem && [
          <Button key="cancel" onClick={() => setReviewItem(null)}>Cancel</Button>,
          <Button key="reject" danger onClick={rejectFromReview} icon={<CloseOutlined />}>Reject</Button>,
          <Button key="approve" type="primary" onClick={handleApproveFromReview} icon={<CheckOutlined />}>
            Approve
          </Button>,
        ]}
      >
        {reviewItem && <ReviewBody item={reviewItem} />}
      </Modal>

      {/* Reject Modal */}
      <Modal title="Reject Item" open={!!rejectModal} onCancel={() => setRejectModal(null)} footer={null}>
        <Form form={form} layout="vertical" onFinish={handleReject}>
          <Form.Item name="remark" label="Reason for Rejection" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setRejectModal(null)}>Cancel</Button>
              <Button type="primary" danger htmlType="submit">Reject</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ReviewBody dispatches on entity type. Each branch is a focused, dense block
// that gives the authorizer enough context to decide before clicking Approve.
function ReviewBody({ item }) {
  const t = item.approval.entity_type;
  if (t === 'investment')    return <InvestmentBody detail={item.detail} />;
  if (t === 'transfer')      return <TransferBody detail={item.detail} />;
  if (t === 'subscription')  return <SubscriptionBody detail={item.detail} />;
  if (t === 'block')         return <BlockBody detail={item.detail} />;
  if (t === 'dividend')      return <DividendBody detail={item.detail} />;
  if (t === 'trade_request') return <TradeBody trade={item.detail} fees={item.extras?.fees} />;
  if (t === 'proxy')         return <ProxyBody data={item.detail} extras={item.extras} />;
  return <Spin />;
}

function InvestmentBody({ detail }) {
  if (!detail) return null;
  const sh = detail.shareholder;
  return (
    <>
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Shareholder" span={2}>
          <Text strong>{fullName(sh)}</Text> ({sh?.account_no})
        </Descriptions.Item>
        <Descriptions.Item label="Payment Date">{fmtDate(detail.payment_date)}</Descriptions.Item>
        <Descriptions.Item label="Method"><Tag>{detail.payment_method}</Tag></Descriptions.Item>
        <Descriptions.Item label="Amount"><Text strong>{formatETB(detail.amount)}</Text></Descriptions.Item>
        <Descriptions.Item label="Shares"><Text strong>{formatN(detail.number_of_shares)}</Text></Descriptions.Item>
        <Descriptions.Item label="Par Value">{formatETB(detail.par_value)}</Descriptions.Item>
        <Descriptions.Item label="Premium">{formatETB(detail.premium_value)}</Descriptions.Item>
        <Descriptions.Item label="Reference No">{detail.reference_no || '-'}</Descriptions.Item>
        <Descriptions.Item label="From Account">{detail.from_account || '-'}</Descriptions.Item>
        <Descriptions.Item label="Allocation Linked">{detail.allocation_id ? `#${detail.allocation_id}` : <Text type="secondary">unlinked (FIFO pool)</Text>}</Descriptions.Item>
        <Descriptions.Item label="Standing">{detail.is_standing ? <Tag color="purple">YES ({detail.standing_frequency})</Tag> : 'No'}</Descriptions.Item>
        {detail.remark && <Descriptions.Item label="Remark" span={2}>{detail.remark}</Descriptions.Item>}
      </Descriptions>
    </>
  );
}

function TransferBody({ detail }) {
  if (!detail) return null;
  return (
    <>
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Batch No">{detail.batch_no || '-'}</Descriptions.Item>
        <Descriptions.Item label="Type"><Tag color="blue">{detail.transfer_type?.toUpperCase()}</Tag></Descriptions.Item>
        <Descriptions.Item label="Transferor" span={2}>
          <Text strong>{fullName(detail.transferor)}</Text> ({detail.transferor?.account_no})
        </Descriptions.Item>
        <Descriptions.Item label="Transferee" span={2}>
          <Text strong>{fullName(detail.transferee)}</Text> ({detail.transferee?.account_no})
        </Descriptions.Item>
        <Descriptions.Item label="Shares"><Text strong>{formatN(detail.number_of_shares)}</Text></Descriptions.Item>
        <Descriptions.Item label="Par Value">{formatETB(detail.par_value)}</Descriptions.Item>
        <Descriptions.Item label="Transfer Amount"><Text strong>{formatETB(detail.transfer_amount)}</Text></Descriptions.Item>
        <Descriptions.Item label="Transfer Date">{fmtDate(detail.transfer_date)}</Descriptions.Item>
        <Descriptions.Item label="Dividend From-Date (agreed)">
          {detail.agreed_dividend_date
            ? <Tag color="gold">{fmtDate(detail.agreed_dividend_date)}</Tag>
            : <Text type="secondary">— not specified —</Text>}
        </Descriptions.Item>
        {detail.dividend_issued_date && (
          <Descriptions.Item label="Dividend Issued Date">{fmtDate(detail.dividend_issued_date)}</Descriptions.Item>
        )}
        <Descriptions.Item label="Full Transfer">{detail.is_full_transfer ? 'Yes' : 'No'}</Descriptions.Item>
        <Descriptions.Item label="Include Subscribed">{detail.include_subscribed ? 'Yes' : 'No'}</Descriptions.Item>
        {detail.reason && <Descriptions.Item label="Reason" span={2}>{detail.reason}</Descriptions.Item>}
      </Descriptions>

      <Card size="small" title={<Space><DollarOutlined /> Fees</Space>} style={{ background: '#fafafa', marginBottom: 12 }}>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="Capital Gain Tax">{formatETB(detail.capital_gain_tax)}</Descriptions.Item>
          <Descriptions.Item label="Service Fee">{formatETB(detail.service_fee)}</Descriptions.Item>
          <Descriptions.Item label="Stamp Duty">{formatETB(detail.stamp_duty)}</Descriptions.Item>
          <Descriptions.Item label="VAT">{formatETB(detail.vat)}</Descriptions.Item>
        </Descriptions>
        <Divider style={{ margin: '8px 0' }} />
        <Row justify="end">
          <Statistic title="Total Fees" value={detail.total_fees} prefix="ETB" precision={2}
            valueStyle={{ color: '#cf1322', fontWeight: 'bold' }} />
        </Row>
      </Card>

      {Array.isArray(detail.lines) && detail.lines.length > 0 && (
        <>
          <Divider orientation="left" style={{ margin: '8px 0' }}>Source Allocations</Divider>
          <Table
            dataSource={detail.lines}
            rowKey="id"
            size="small"
            pagination={false}
            columns={[
              { title: 'Allocation', dataIndex: 'from_allocation_id', render: (v) => `#${v}` },
              { title: 'Paid Shares', dataIndex: 'paid_shares_to_transfer', render: formatN },
              { title: 'Unpaid Shares', dataIndex: 'unpaid_shares_to_transfer', render: formatN },
            ]}
          />
        </>
      )}
    </>
  );
}

function SubscriptionBody({ detail }) {
  if (!detail) return null;
  const sh = detail.shareholder;
  return (
    <>
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Shareholder" span={2}>
          <Text strong>{fullName(sh)}</Text> ({sh?.account_no})
        </Descriptions.Item>
        <Descriptions.Item label="Subscription No">{detail.subscription_no || '-'}</Descriptions.Item>
        <Descriptions.Item label="Type"><Tag color="green">{detail.type?.toUpperCase()}</Tag></Descriptions.Item>
        <Descriptions.Item label="Shares"><Text strong>{formatN(detail.number_of_shares)}</Text></Descriptions.Item>
        <Descriptions.Item label="Share Amount"><Text strong>{formatETB(detail.share_amount)}</Text></Descriptions.Item>
        <Descriptions.Item label="Par Value">{formatETB(detail.par_value)}</Descriptions.Item>
        <Descriptions.Item label="Subscription Date">{fmtDate(detail.subscription_date)}</Descriptions.Item>
        <Descriptions.Item label="Expiry Date">{fmtDate(detail.expiry_date)}</Descriptions.Item>
        <Descriptions.Item label="Status">
          <Tag color={detail.status === 'active' ? 'green' : 'default'}>{detail.status}</Tag>
        </Descriptions.Item>
        {detail.capital_increase_id && (
          <>
            <Descriptions.Item label="Capital Increase">#{detail.capital_increase_id}</Descriptions.Item>
            <Descriptions.Item label="Round">{detail.round}</Descriptions.Item>
          </>
        )}
        {detail.is_proportional && (
          <Descriptions.Item label="Proportional" span={2}>
            <Tag color="blue">Yes</Tag> (system-generated from Hamilton allocation, basis {formatN(detail.base_shares)})
          </Descriptions.Item>
        )}
        {detail.remark && <Descriptions.Item label="Remark" span={2}>{detail.remark}</Descriptions.Item>}
      </Descriptions>
    </>
  );
}

function BlockBody({ detail }) {
  if (!detail) return null;
  const sh = detail.shareholder;
  return (
    <>
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Shareholder" span={2}>
          <Text strong>{fullName(sh)}</Text> ({sh?.account_no})
        </Descriptions.Item>
        <Descriptions.Item label="Block Type"><Tag color="red">{detail.block_type?.toUpperCase()}</Tag></Descriptions.Item>
        <Descriptions.Item label="Block Date">{fmtDate(detail.block_date)}</Descriptions.Item>
        <Descriptions.Item label="Block Shares"><Text strong>{formatN(detail.block_shares)}</Text></Descriptions.Item>
        <Descriptions.Item label="Block Amount">{formatETB(detail.block_amount_birr)}</Descriptions.Item>
        <Descriptions.Item label="Shares Type"><Tag>{detail.shares_type}</Tag></Descriptions.Item>
        <Descriptions.Item label="Allocation">{detail.allocation_id ? `#${detail.allocation_id}` : <Text type="secondary">all</Text>}</Descriptions.Item>
        <Descriptions.Item label="Paid Shares Blocked">{formatN(detail.paid_shares_to_block)}</Descriptions.Item>
        <Descriptions.Item label="Unpaid Shares Blocked">{formatN(detail.unpaid_shares_to_block)}</Descriptions.Item>
        <Descriptions.Item label="Guarantee Amount">{formatETB(detail.guarantee_amount)}</Descriptions.Item>
        <Descriptions.Item label="Service Fee">{formatETB(detail.service_fee)}</Descriptions.Item>
        {detail.release_date && (
          <Descriptions.Item label="Release Date" span={2}>{fmtDate(detail.release_date)}</Descriptions.Item>
        )}
        {detail.reason && <Descriptions.Item label="Reason" span={2}>{detail.reason}</Descriptions.Item>}
      </Descriptions>
    </>
  );
}

function DividendBody({ detail }) {
  if (!detail) return null;
  const sh = detail.shareholder;
  return (
    <>
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Shareholder" span={2}>
          <Text strong>{fullName(sh)}</Text> ({sh?.account_no})
        </Descriptions.Item>
        <Descriptions.Item label="Fiscal Year"><Tag color="orange">{detail.fiscal_year}</Tag></Descriptions.Item>
        <Descriptions.Item label="Weighted Avg Shares">{formatN(detail.weighted_avg_shares)}</Descriptions.Item>
        <Descriptions.Item label="Gross Dividend"><Text strong>{formatETB(detail.gross_dividend)}</Text></Descriptions.Item>
        <Descriptions.Item label="Tax">{formatETB(detail.tax_amount)}</Descriptions.Item>
        <Descriptions.Item label="Net Dividend"><Text strong style={{ color: '#3f8600' }}>{formatETB(detail.net_dividend)}</Text></Descriptions.Item>
        <Descriptions.Item label="Collected">{formatETB(detail.collected_amount)}</Descriptions.Item>
        <Descriptions.Item label="Uncollected">{formatETB(detail.uncollected_amount)}</Descriptions.Item>
        <Descriptions.Item label="Payment Method">{detail.payment_method || '-'}</Descriptions.Item>
        <Descriptions.Item label="Collection Date">{fmtDate(detail.collection_date)}</Descriptions.Item>
        <Descriptions.Item label="Blocked">{detail.is_blocked ? <Tag color="red">YES</Tag> : 'No'}</Descriptions.Item>
        <Descriptions.Item label="Tax Returned">{detail.is_tax_returned ? 'Yes' : 'No'}</Descriptions.Item>
        {detail.block_reason && <Descriptions.Item label="Block Reason" span={2}>{detail.block_reason}</Descriptions.Item>}
        {detail.remark && <Descriptions.Item label="Remark" span={2}>{detail.remark}</Descriptions.Item>}
      </Descriptions>

      {/* Pending-transfer details — surfaced when this approval is a
          dividend transfer request. */}
      {detail.is_transfer_pending && (
        <Card size="small" title={<Space><SwapOutlined /> Pending Transfer Request</Space>}
          style={{ background: '#fffbe6', borderColor: '#ffe58f', marginBottom: 12 }}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="Transfer To" span={2}>
              <Text strong>{detail.transfer_to || '-'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Reason">
              <Tag color="purple">{detail.transfer_reason || '-'}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Amount to Transfer">
              <Text strong style={{ color: '#cf1322' }}>
                {formatETB((detail.gross_dividend || 0) - (detail.reinvested_amount || 0) - (detail.collected_amount || 0))}
              </Text>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}
    </>
  );
}

function TradeBody({ trade, fees }) {
  if (!trade || !fees) return <Spin />;
  return (
    <>
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Seller">{fullName(trade.seller)} ({trade.seller?.account_no})</Descriptions.Item>
        <Descriptions.Item label="Buyer">{fullName(trade.buyer)} ({trade.buyer?.account_no})</Descriptions.Item>
        <Descriptions.Item label="Shares">{formatN(trade.number_of_shares)}</Descriptions.Item>
        <Descriptions.Item label="Price/Share">{formatETB(trade.price_per_share)}</Descriptions.Item>
        <Descriptions.Item label="Transfer Type"><Tag color="blue">Sale</Tag></Descriptions.Item>
        <Descriptions.Item label="Total Value"><Text strong>{formatETB(trade.total_value)}</Text></Descriptions.Item>
      </Descriptions>

      <Card size="small" title={<Space><DollarOutlined /> Fee Calculation Preview</Space>}
        style={{ background: '#fafafa' }}>
        <Row gutter={16}>
          <Statistic title="Transfer Value" value={fees.transfer_value} prefix="ETB" precision={2}
            style={{ flex: 1, textAlign: 'center' }} />
        </Row>
        <Divider style={{ margin: '12px 0' }} />
        <Descriptions size="small" column={2}>
          <Descriptions.Item label={`Capital Gain Tax (${fees.cgt_rate}%)`}>{formatETB(fees.capital_gain_tax)}</Descriptions.Item>
          <Descriptions.Item label={`Service Fee (${fees.sf_rate}%)`}>{formatETB(fees.service_fee)}</Descriptions.Item>
          <Descriptions.Item label={`Stamp Duty (${fees.sd_rate}%)`}>{formatETB(fees.stamp_duty)}</Descriptions.Item>
          <Descriptions.Item label={`VAT on Fee (${fees.vat_rate}%)`}>{formatETB(fees.vat)}</Descriptions.Item>
        </Descriptions>
        <Divider style={{ margin: '12px 0' }} />
        <Row justify="end">
          <Statistic title="Total Fees" value={fees.total_fees} prefix="ETB" precision={2}
            valueStyle={{ color: '#cf1322', fontWeight: 'bold' }} />
        </Row>
      </Card>
    </>
  );
}

function ProxyBody({ data, extras }) {
  if (!data) return <Spin />;
  return (
    <>
      {extras?.meeting && (
        <Card size="small" style={{ marginBottom: 16, background: '#fff1f0' }}>
          <Space>
            <CalendarOutlined style={{ fontSize: 18, color: '#d32f2f' }} />
            <div>
              <Text strong>{extras.meeting.title}</Text>
              <br />
              <Text type="secondary">
                {fmtDateTime(extras.meeting.meeting_date)}
                {' · '}
                <Tag color="blue" style={{ marginLeft: 4 }}>{extras.meeting.meeting_type?.toUpperCase()}</Tag>
                <Tag color={extras.meeting.status === 'active' ? 'green' : extras.meeting.status === 'closed' ? 'red' : 'orange'}>
                  {extras.meeting.status?.toUpperCase()}
                </Tag>
              </Text>
            </div>
          </Space>
        </Card>
      )}

      <Descriptions bordered size="small" column={2} title={<Space><UserOutlined /> Shareholder</Space>} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Name" span={2}>{fullName(data.shareholder)}</Descriptions.Item>
        <Descriptions.Item label="Account No">{data.shareholder?.account_no}</Descriptions.Item>
        <Descriptions.Item label="Phone">{data.shareholder?.phone || '-'}</Descriptions.Item>
        <Descriptions.Item label="National ID">{data.shareholder?.national_id_no || '-'}</Descriptions.Item>
        <Descriptions.Item label="Type"><Tag>{data.shareholder?.shareholder_type}</Tag></Descriptions.Item>
        <Descriptions.Item label="Status">
          <Tag color={data.shareholder?.status === 'active' ? 'green' : 'orange'}>
            {data.shareholder?.status?.toUpperCase()}
          </Tag>
        </Descriptions.Item>
      </Descriptions>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Statistic title="Total Shares" value={extras?.shares || 0} valueStyle={{ color: '#d32f2f', fontWeight: 'bold' }} /></Col>
        <Col span={6}><Statistic title="Total Paid" value={extras?.total_paid || 0} prefix="ETB" precision={2} valueStyle={{ fontWeight: 'bold' }} /></Col>
        <Col span={6}><Statistic title="Investments" value={extras?.investments?.length || 0} /></Col>
        <Col span={6}><Statistic title="Transfers" value={extras?.transfer_count || 0} /></Col>
      </Row>

      {extras?.investments?.length > 0 && (
        <>
          <Divider orientation="left" style={{ margin: '8px 0' }}>Recent Investments</Divider>
          <Table
            dataSource={extras.investments.slice(0, 5)}
            rowKey="id"
            size="small"
            pagination={false}
            style={{ marginBottom: 16 }}
            columns={[
              { title: 'Date', dataIndex: 'payment_date', width: 100, render: fmtDate },
              { title: 'Shares', dataIndex: 'number_of_shares', width: 80, render: formatN },
              { title: 'Amount', dataIndex: 'amount', width: 120, render: formatETB },
              { title: 'Method', dataIndex: 'payment_method', width: 100, render: v => <Tag>{v}</Tag> },
            ]}
          />
        </>
      )}

      <Divider orientation="left" style={{ margin: '8px 0' }}>Proxy Person</Divider>
      <Card size="small" style={{ background: '#fff7e6', border: '1px solid #ffd591' }}>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="Name" span={2}><Text strong>{data.proxy_name}</Text></Descriptions.Item>
          <Descriptions.Item label="Phone">{data.proxy_phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="ID No">{data.proxy_id_no || '-'}</Descriptions.Item>
          <Descriptions.Item label="Proxy Code">
            <Tag color="blue" style={{ fontFamily: 'monospace', fontSize: 14 }}>{data.proxy_code}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={data.status === 'pending' ? 'orange' : data.status === 'approved' ? 'green' : 'red'}>
              {data.status?.toUpperCase()}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </>
  );
}
