import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Descriptions, Table, Tag, Tooltip, Tabs, Spin, Button, Row, Col, Statistic, Typography, Space,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { getShareholder } from '../services/api';
import { formatCurrency, formatNumber } from '../utils/format';
import dayjs from 'dayjs';

const { Title } = Typography;

export default function ShareholderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getShareholder(id).then(res => setData(res.data)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!data) return <div>Shareholder not found</div>;

  const sh = data.shareholder;
  const summary = data.summary;

  const investmentColumns = [
    { title: 'Date', dataIndex: 'payment_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
    { title: 'Method', dataIndex: 'payment_method' },
    { title: 'Amount', dataIndex: 'amount', render: (v) => formatCurrency(v) },
    { title: 'Shares', dataIndex: 'number_of_shares', render: (v) => formatNumber(v) },
    { title: 'Status', dataIndex: 'approval_status', render: (s, r) => {
      const color = s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange';
      const tag = <Tag color={color}>{s}</Tag>;
      return s === 'rejected' && r.rejection_reason
        ? <Tooltip title={r.rejection_reason} placement="left">{tag}</Tooltip>
        : tag;
    } },
  ];

  const subscriptionColumns = [
    { title: 'Type', dataIndex: 'type' },
    { title: 'Amount', dataIndex: 'share_amount', render: (v) => formatCurrency(v) },
    { title: 'Shares', dataIndex: 'number_of_shares', render: (v) => formatNumber(v) },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'active' ? 'green' : 'red'}>{s}</Tag> },
  ];

  const dividendColumns = [
    { title: 'Fiscal Year', dataIndex: 'fiscal_year' },
    { title: 'Gross', dataIndex: 'gross_dividend', render: (v) => formatCurrency(v) },
    { title: 'Tax', dataIndex: 'tax_amount', render: (v) => formatCurrency(v) },
    { title: 'Net', dataIndex: 'net_dividend', render: (v) => formatCurrency(v) },
    { title: 'Collected', dataIndex: 'collected_amount', render: (v) => formatCurrency(v) },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag>{s}</Tag> },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/shareholders')}>Back</Button>
        <Title level={4} style={{ margin: 0 }}>{sh.first_name} {sh.middle_name} {sh.last_name}</Title>
        <Tag color={sh.status === 'active' ? 'green' : 'red'}>{sh.status}</Tag>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={6}><Card><Statistic title="Total Shares" value={summary.total_shares} /></Card></Col>
        <Col xs={24} lg={6}><Card><Statistic title="Total Invested" value={summary.total_invested} formatter={(v) => formatCurrency(v)} /></Card></Col>
        <Col xs={24} lg={6}><Card><Statistic title="Total Subscribed" value={summary.total_subscribed} formatter={(v) => formatCurrency(v)} /></Card></Col>
        <Col xs={24} lg={6}><Card><Statistic title="Blocked Shares" value={summary.blocked_shares} valueStyle={{ color: summary.blocked_shares > 0 ? '#f5222d' : undefined }} /></Card></Col>
      </Row>

      <Card style={{ marginTop: 16 }}>
        <Tabs items={[
          {
            key: 'info', label: 'Personal Info',
            children: (
              <Descriptions bordered column={3} size="small">
                <Descriptions.Item label="Account No">{sh.account_no}</Descriptions.Item>
                <Descriptions.Item label="Type">{sh.shareholder_type}</Descriptions.Item>
                <Descriptions.Item label="Gender">{sh.gender}</Descriptions.Item>
                <Descriptions.Item label="First Name">{sh.first_name}</Descriptions.Item>
                <Descriptions.Item label="Middle Name">{sh.middle_name}</Descriptions.Item>
                <Descriptions.Item label="Last Name">{sh.last_name}</Descriptions.Item>
                {(sh.first_name_am || sh.middle_name_am || sh.last_name_am) && (
                  <>
                    <Descriptions.Item label="ስም (አማርኛ)">{sh.first_name_am}</Descriptions.Item>
                    <Descriptions.Item label="የአባት ስም (አማርኛ)">{sh.middle_name_am}</Descriptions.Item>
                    <Descriptions.Item label="የአያት ስም (አማርኛ)">{sh.last_name_am}</Descriptions.Item>
                  </>
                )}
                <Descriptions.Item label="TIN">{sh.tin}</Descriptions.Item>
                <Descriptions.Item label="Passport">{sh.passport_no}</Descriptions.Item>
                <Descriptions.Item label="National ID">{sh.national_id_no}</Descriptions.Item>
                <Descriptions.Item label="Nationality">{sh.nationality}{sh.nationality_am ? ` / ${sh.nationality_am}` : ''}</Descriptions.Item>
                <Descriptions.Item label="Staff">{sh.is_staff ? 'Yes' : 'No'}</Descriptions.Item>
                <Descriptions.Item label="Foreign">{sh.is_foreign ? 'Yes' : 'No'}</Descriptions.Item>
                <Descriptions.Item label="Citizenship">{sh.citizenship_status}</Descriptions.Item>
                <Descriptions.Item label="Phone 1">{sh.phone || '-'}</Descriptions.Item>
                {sh.phone2 && <Descriptions.Item label="Phone 2">{sh.phone2}</Descriptions.Item>}
                {sh.phone3 && <Descriptions.Item label="Phone 3">{sh.phone3}</Descriptions.Item>}
                <Descriptions.Item label="Email 1">{sh.email || '-'}</Descriptions.Item>
                {sh.email2 && <Descriptions.Item label="Email 2">{sh.email2}</Descriptions.Item>}
                {sh.email3 && <Descriptions.Item label="Email 3">{sh.email3}</Descriptions.Item>}
                {sh.address && (
                  <>
                    <Descriptions.Item label="Region">{sh.address.region}{sh.address.region_am ? ` / ${sh.address.region_am}` : ''}</Descriptions.Item>
                    <Descriptions.Item label="City">{sh.address.city}{sh.address.city_am ? ` / ${sh.address.city_am}` : ''}</Descriptions.Item>
                    <Descriptions.Item label="Sub City">{sh.address.sub_city}{sh.address.sub_city_am ? ` / ${sh.address.sub_city_am}` : ''}</Descriptions.Item>
                    <Descriptions.Item label="Woreda">{sh.address.woreda}{sh.address.woreda_am ? ` / ${sh.address.woreda_am}` : ''}</Descriptions.Item>
                    <Descriptions.Item label="Kebele">{sh.address.kebele}{sh.address.kebele_am ? ` / ${sh.address.kebele_am}` : ''}</Descriptions.Item>
                    <Descriptions.Item label="House No">{sh.address.house_no}</Descriptions.Item>
                  </>
                )}
              </Descriptions>
            ),
          },
          {
            key: 'investments', label: `Investments (${(sh.investments || []).length})`,
            children: <Table dataSource={sh.investments || []} columns={investmentColumns} rowKey="id" size="small" pagination={false} />,
          },
          {
            key: 'subscriptions', label: `Subscriptions (${(sh.subscriptions || []).length})`,
            children: <Table dataSource={sh.subscriptions || []} columns={subscriptionColumns} rowKey="id" size="small" pagination={false} />,
          },
          {
            key: 'dividends', label: `Dividends (${(sh.dividends || []).length})`,
            children: <Table dataSource={sh.dividends || []} columns={dividendColumns} rowKey="id" size="small" pagination={false} />,
          },
        ]} />
      </Card>
    </div>
  );
}
