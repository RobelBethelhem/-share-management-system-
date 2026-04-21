import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Space, Tag,
  message, Typography, Row, Popconfirm, Descriptions, Statistic, Card, Divider,
} from 'antd';
import { CheckOutlined, CloseOutlined, ShopOutlined, DollarOutlined, TeamOutlined, UserOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getApprovals, approveItem, rejectItem } from '../services/api';
import api from '../services/api';

const { Title, Text } = Typography;

export default function Approvals() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [rejectModal, setRejectModal] = useState(null);
  const [tradeDetail, setTradeDetail] = useState(null);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [proxyDetail, setProxyDetail] = useState(null);
  const [form] = Form.useForm();

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

  const handleApprove = async (record) => {
    // For trade requests, show detail modal first
    if (record.entity_type === 'trade_request') {
      setTradeLoading(true);
      try {
        const res = await api.get(`/marketplace/trades/${record.entity_id}`);
        setTradeDetail({ ...res.data, approvalId: record.id });
      } catch { message.error('Failed to load trade details'); }
      setTradeLoading(false);
      return;
    }
    // For proxy requests, show detail modal
    if (record.entity_type === 'proxy') {
      try {
        const res = await api.get(`/agm/proxy/${record.entity_id}`);
        setProxyDetail({ ...res.data, approvalId: record.id });
      } catch { message.error('Failed to load proxy details'); }
      return;
    }
    // Standard approval
    try {
      await approveItem(record.id);
      message.success('Approved');
      fetchData();
    } catch (err) { message.error(err.response?.data?.error || 'Failed'); }
  };

  const handleTradeApprove = async () => {
    if (!tradeDetail) return;
    try {
      await approveItem(tradeDetail.approvalId);
      message.success('Trade approved! Transfer created successfully.');
      setTradeDetail(null);
      fetchData();
    } catch (err) { message.error(err.response?.data?.error || 'Failed'); }
  };

  const handleReject = async (values) => {
    try {
      await rejectItem(rejectModal.id, values);
      message.success('Rejected');
      setRejectModal(null);
      fetchData();
    } catch (err) { message.error(err.response?.data?.error || 'Failed'); }
  };

  const typeColors = {
    investment: 'blue', transfer: 'purple', subscription: 'green',
    block: 'red', dividend: 'orange', trade_request: 'magenta', proxy: 'cyan',
  };

  const typeLabels = {
    investment: 'INVESTMENT', transfer: 'TRANSFER', subscription: 'SUBSCRIPTION',
    block: 'SHARE BLOCK', dividend: 'DIVIDEND', trade_request: 'MARKETPLACE TRADE', proxy: 'AGM PROXY',
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 50 },
    {
      title: 'Type', dataIndex: 'entity_type', width: 160,
      render: (t) => <Tag color={typeColors[t] || 'default'}>{typeLabels[t] || t?.toUpperCase()}</Tag>,
    },
    { title: 'Entity ID', dataIndex: 'entity_id', width: 80 },
    { title: 'Action', dataIndex: 'action', width: 80, render: (a) => <Tag>{a}</Tag> },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'pending' ? 'orange' : s === 'approved' ? 'green' : 'red'}>{s}</Tag> },
    { title: 'Requested', dataIndex: 'requested_at', render: (d) => d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '-' },
    {
      title: 'Actions', key: 'actions', width: 200,
      render: (_, r) => r.status === 'pending' && (
        <Space>
          <Button size="small" type="primary" icon={<CheckOutlined />}
            onClick={() => handleApprove(r)}
            loading={r.entity_type === 'trade_request' && tradeLoading}>
            {(r.entity_type === 'trade_request' || r.entity_type === 'proxy') ? 'Review & Approve' : 'Approve'}
          </Button>
          <Button size="small" danger icon={<CloseOutlined />} onClick={() => { setRejectModal(r); form.resetFields(); }}>
            Reject
          </Button>
        </Space>
      ),
    },
  ];

  const formatETB = (v) => `ETB ${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  const trade = tradeDetail?.data;
  const fees = tradeDetail?.fees;
  const sellerName = trade ? `${trade.seller?.first_name || ''} ${trade.seller?.last_name || ''}`.trim() : '';
  const buyerName = trade ? `${trade.buyer?.first_name || ''} ${trade.buyer?.last_name || ''}`.trim() : '';

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Authorization & Rejection</Title>
        <Select placeholder="Filter by type" allowClear style={{ width: 200 }}
          onChange={(v) => { setEntityType(v || ''); setPage(1); }}
          options={[
            { value: 'investment', label: 'Investment' },
            { value: 'transfer', label: 'Transfer' },
            { value: 'subscription', label: 'Subscription' },
            { value: 'block', label: 'Share Block' },
            { value: 'dividend', label: 'Dividend' },
            { value: 'trade_request', label: 'Marketplace Trade' },
            { value: 'proxy', label: 'AGM Proxy' },
          ]}
        />
      </Row>

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }} />

      {/* Trade Approval Modal with Fee Preview */}
      <Modal
        title={<Space><ShopOutlined /> Marketplace Trade Approval</Space>}
        open={!!tradeDetail}
        onCancel={() => setTradeDetail(null)}
        width={650}
        footer={[
          <Button key="cancel" onClick={() => setTradeDetail(null)}>Cancel</Button>,
          <Button key="reject" danger onClick={() => { setRejectModal({ id: tradeDetail?.approvalId }); setTradeDetail(null); form.resetFields(); }}>
            Reject
          </Button>,
          <Button key="approve" type="primary" onClick={handleTradeApprove}>
            Approve & Create Transfer
          </Button>,
        ]}
      >
        {trade && fees && (
          <>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Seller">{sellerName} ({trade.seller?.account_no})</Descriptions.Item>
              <Descriptions.Item label="Buyer">{buyerName} ({trade.buyer?.account_no})</Descriptions.Item>
              <Descriptions.Item label="Shares">{trade.number_of_shares?.toLocaleString()}</Descriptions.Item>
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
        )}
      </Modal>

      {/* Proxy Approval Modal */}
      <Modal
        title={<Space><TeamOutlined /> AGM Proxy Authorization Review</Space>}
        open={!!proxyDetail}
        onCancel={() => setProxyDetail(null)}
        width={650}
        footer={[
          <Button key="cancel" onClick={() => setProxyDetail(null)}>Cancel</Button>,
          <Button key="reject" danger onClick={() => {
            setRejectModal({ id: proxyDetail?.approvalId });
            setProxyDetail(null);
            form.resetFields();
          }}>Reject</Button>,
          <Button key="approve" type="primary" onClick={async () => {
            try {
              await approveItem(proxyDetail.approvalId);
              message.success('Proxy approved! The proxy person can now login and vote.');
              setProxyDetail(null);
              fetchData();
            } catch (err) { message.error(err.response?.data?.error || 'Failed'); }
          }}>Approve Proxy</Button>,
        ]}
      >
        {proxyDetail?.data && (
          <>
            {/* Meeting Info */}
            {proxyDetail.meeting && (
              <Card size="small" style={{ marginBottom: 16, background: '#fff1f0' }}>
                <Space>
                  <CalendarOutlined style={{ fontSize: 18, color: '#d32f2f' }} />
                  <div>
                    <Text strong>{proxyDetail.meeting.title}</Text>
                    <br />
                    <Text type="secondary">
                      {proxyDetail.meeting.meeting_date ? dayjs(proxyDetail.meeting.meeting_date).format('YYYY-MM-DD HH:mm') : '-'}
                      {' · '}
                      <Tag color="blue" style={{ marginLeft: 4 }}>{proxyDetail.meeting.meeting_type?.toUpperCase()}</Tag>
                      <Tag color={proxyDetail.meeting.status === 'active' ? 'green' : proxyDetail.meeting.status === 'closed' ? 'red' : 'orange'}>
                        {proxyDetail.meeting.status?.toUpperCase()}
                      </Tag>
                    </Text>
                  </div>
                </Space>
              </Card>
            )}

            {/* Shareholder Info */}
            <Descriptions bordered size="small" column={2} title={<Space><UserOutlined /> Shareholder</Space>} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Name" span={2}>
                {proxyDetail.data.shareholder?.first_name} {proxyDetail.data.shareholder?.middle_name} {proxyDetail.data.shareholder?.last_name}
              </Descriptions.Item>
              <Descriptions.Item label="Account No">{proxyDetail.data.shareholder?.account_no}</Descriptions.Item>
              <Descriptions.Item label="Phone">{proxyDetail.data.shareholder?.phone || '-'}</Descriptions.Item>
              <Descriptions.Item label="National ID">{proxyDetail.data.shareholder?.national_id_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="Type">
                <Tag>{proxyDetail.data.shareholder?.shareholder_type}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={proxyDetail.data.shareholder?.status === 'active' ? 'green' : 'orange'}>
                  {proxyDetail.data.shareholder?.status?.toUpperCase()}
                </Tag>
              </Descriptions.Item>
            </Descriptions>

            {/* Share Summary */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <div style={{ flex: 1, padding: '0 8px' }}>
                <Statistic title="Total Shares" value={proxyDetail.shares || 0} valueStyle={{ color: '#d32f2f', fontWeight: 'bold' }} />
              </div>
              <div style={{ flex: 1, padding: '0 8px' }}>
                <Statistic title="Total Paid" value={proxyDetail.total_paid || 0} prefix="ETB" precision={2} valueStyle={{ fontWeight: 'bold' }} />
              </div>
              <div style={{ flex: 1, padding: '0 8px' }}>
                <Statistic title="Investments" value={proxyDetail.investments?.length || 0} />
              </div>
              <div style={{ flex: 1, padding: '0 8px' }}>
                <Statistic title="Transfers" value={proxyDetail.transfer_count || 0} />
              </div>
            </Row>

            {/* Investment Table */}
            {proxyDetail.investments?.length > 0 && (
              <>
                <Divider orientation="left" style={{ margin: '8px 0' }}>Recent Investments</Divider>
                <Table
                  dataSource={proxyDetail.investments.slice(0, 5)}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  style={{ marginBottom: 16 }}
                  columns={[
                    { title: 'Date', dataIndex: 'payment_date', width: 100, render: d => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
                    { title: 'Shares', dataIndex: 'number_of_shares', width: 80, render: v => v?.toLocaleString() },
                    { title: 'Amount', dataIndex: 'amount', width: 120, render: v => `ETB ${v?.toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
                    { title: 'Method', dataIndex: 'payment_method', width: 100, render: v => <Tag>{v}</Tag> },
                  ]}
                />
              </>
            )}

            {/* Proxy Person */}
            <Divider orientation="left" style={{ margin: '8px 0' }}>Proxy Person</Divider>
            <Card size="small" style={{ background: '#fff7e6', border: '1px solid #ffd591' }}>
              <Descriptions size="small" column={2}>
                <Descriptions.Item label="Name" span={2}><Text strong>{proxyDetail.data.proxy_name}</Text></Descriptions.Item>
                <Descriptions.Item label="Phone">{proxyDetail.data.proxy_phone || '-'}</Descriptions.Item>
                <Descriptions.Item label="ID No">{proxyDetail.data.proxy_id_no || '-'}</Descriptions.Item>
                <Descriptions.Item label="Proxy Code">
                  <Tag color="blue" style={{ fontFamily: 'monospace', fontSize: 14 }}>{proxyDetail.data.proxy_code}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Status">
                  <Tag color={proxyDetail.data.status === 'pending' ? 'orange' : proxyDetail.data.status === 'approved' ? 'green' : 'red'}>
                    {proxyDetail.data.status?.toUpperCase()}
                  </Tag>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </>
        )}
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
