import { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Spin, Typography, Table, Tag, Progress, Badge, Tooltip } from 'antd';
import {
  UserOutlined, DollarOutlined, BankOutlined, FileTextOutlined,
  GlobalOutlined, SwapOutlined, LockOutlined, SafetyCertificateOutlined,
  CheckCircleOutlined, TeamOutlined, RiseOutlined, FundOutlined,
  WarningOutlined, ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend,
  AreaChart, Area, LineChart, Line, RadialBarChart, RadialBar,
} from 'recharts';
import { getDashboard } from '../services/api';
import { formatCurrency, formatNumber } from '../utils/format';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const PIE_COLORS = ['#d32f2f', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96'];
const GRADIENT_CARDS = [
  { bg: 'linear-gradient(135deg, #e53935 0%, #880e4f 100%)', color: '#fff' },
  { bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', color: '#fff' },
  { bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', color: '#fff' },
  { bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', color: '#fff' },
  { bg: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', color: '#fff' },
  { bg: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)', color: '#fff' },
  { bg: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)', color: '#333' },
  { bg: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)', color: '#fff' },
];

const StatCard = ({ title, value, icon, gradient, prefix, suffix, precision = 0, formatter }) => (
  <Card
    hoverable
    style={{
      background: gradient.bg,
      borderRadius: 12,
      border: 'none',
      boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
    }}
    styles={{ body: { padding: '20px 24px' } }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <Text style={{ color: gradient.color, opacity: 0.85, fontSize: 13, display: 'block', marginBottom: 8 }}>
          {title}
        </Text>
        <div style={{ color: gradient.color, fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>
          {formatter ? formatter(value) : (
            <>
              {prefix}{typeof value === 'number' ? value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision }) : value}{suffix}
            </>
          )}
        </div>
      </div>
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: 'rgba(255,255,255,0.2)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 22, color: gradient.color,
      }}>
        {icon}
      </div>
    </div>
  </Card>
);

const ChartCard = ({ title, children, extra }) => (
  <Card
    title={<span style={{ fontWeight: 600 }}>{title}</span>}
    extra={extra}
    style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
    styles={{ body: { padding: '12px 16px' } }}
  >
    {children}
  </Card>
);

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboard()
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  const categoryData = (data?.investor_categories || []).map((c, i) => ({
    name: c.type || 'Unknown', value: c.count, fill: PIE_COLORS[i % PIE_COLORS.length],
  }));

  const genderData = (data?.gender_distribution || []).map((g, i) => ({
    name: g.gender || 'Unknown', value: g.count, fill: i === 0 ? '#d32f2f' : '#eb2f96',
  }));

  const investmentTrend = (data?.investment_trend || []).map(t => ({
    ...t, amount: Number((t.amount / 1000000).toFixed(2)),
  }));

  const registrationTrend = data?.registration_trend || [];
  const dividendByYear = data?.dividend_by_year || [];
  const topShareholders = data?.top_shareholders || [];
  const recentInvestments = data?.recent_investments || [];
  const recentTransfers = data?.recent_transfers || [];
  const subStatuses = data?.subscription_status || [];
  const transferTypes = data?.transfer_types || [];
  const blockTypes = (data?.block_types || []).map((b, i) => ({
    ...b, fill: PIE_COLORS[i % PIE_COLORS.length],
  }));
  const pendingByType = data?.pending_by_type || [];

  const capitalUtil = data?.capital_utilization || 0;

  const CustomPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 1.4;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    if (percent < 0.05) return null;
    return (
      <text x={x} y={y} fill="#666" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={12}>
        {name} ({(percent * 100).toFixed(0)}%)
      </text>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>
          <FundOutlined style={{ marginRight: 8 }} />Dashboard Overview
        </Title>
        <Text type="secondary">{dayjs().format('dddd, MMMM D, YYYY')}</Text>
      </div>

      {/* ── Primary Stat Cards ── */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="Active Shareholders" value={data?.active_shareholders || 0}
            icon={<UserOutlined />} gradient={GRADIENT_CARDS[0]} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="Total Paid-up Capital" value={data?.total_paid_up_capital || 0}
            icon={<BankOutlined />} gradient={GRADIENT_CARDS[2]}
            formatter={(v) => formatCurrency(v)} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="Uncollected Dividend" value={data?.total_uncollected_dividend || 0}
            icon={<DollarOutlined />} gradient={GRADIENT_CARDS[1]}
            formatter={(v) => formatCurrency(v)} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="Total Shares Issued" value={data?.total_shares || 0}
            icon={<FileTextOutlined />} gradient={GRADIENT_CARDS[3]} />
        </Col>
      </Row>

      {/* ── Secondary Stat Cards ── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable style={{ borderRadius: 10, textAlign: 'center' }}>
            <Statistic title="Subscriptions" value={data?.total_subscriptions || 0}
              prefix={<FileTextOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ fontSize: 20 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable style={{ borderRadius: 10, textAlign: 'center' }}>
            <Statistic title="Transfers" value={data?.total_transfers || 0}
              prefix={<SwapOutlined style={{ color: '#722ed1' }} />}
              valueStyle={{ fontSize: 20 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable style={{ borderRadius: 10, textAlign: 'center' }}>
            <Statistic title="Blocked Shares" value={data?.total_blocked || 0}
              prefix={<LockOutlined style={{ color: '#f5222d' }} />}
              valueStyle={{ fontSize: 20, color: data?.total_blocked > 0 ? '#f5222d' : undefined }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable style={{ borderRadius: 10, textAlign: 'center' }}>
            <Badge count={data?.pending_approvals || 0} overflowCount={99}>
              <Statistic title="Pending Approvals" value={data?.pending_approvals || 0}
                prefix={<CheckCircleOutlined style={{ color: '#faad14' }} />}
                valueStyle={{ fontSize: 20, color: data?.pending_approvals > 0 ? '#faad14' : undefined }} />
            </Badge>
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable style={{ borderRadius: 10, textAlign: 'center' }}>
            <Statistic title="Certificates" value={data?.total_certificates || 0}
              prefix={<SafetyCertificateOutlined style={{ color: '#13c2c2' }} />}
              valueStyle={{ fontSize: 20 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" hoverable style={{ borderRadius: 10, textAlign: 'center' }}>
            <Statistic title="Service Fees" value={data?.total_service_fees || 0}
              prefix="ETB" precision={0}
              valueStyle={{ fontSize: 18 }} />
          </Card>
        </Col>
      </Row>

      {/* ── Charts Row 1 ── */}
      <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
        {/* Investment Trend Area Chart */}
        <Col xs={24} lg={16}>
          <ChartCard title="Investment Trend (Monthly)" extra={<Tag color="blue">Last 12 Months</Tag>}>
            {investmentTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={investmentTrend}>
                  <defs>
                    <linearGradient id="investGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#d32f2f" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#d32f2f" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RTooltip formatter={(v) => [`${v}M ETB`, 'Amount']} />
                  <Area type="monotone" dataKey="amount" stroke="#d32f2f" strokeWidth={2.5}
                    fill="url(#investGrad)" name="Amount (Millions)" />
                  <Line type="monotone" dataKey="count" stroke="#52c41a" strokeWidth={2}
                    dot={{ r: 3 }} name="Transactions" yAxisId={0} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>No investment data yet</div>
            )}
          </ChartCard>
        </Col>

        {/* Capital Utilization + Foreign Nationals */}
        <Col xs={24} lg={8}>
          <ChartCard title="Capital Utilization">
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Progress
                type="dashboard"
                percent={Number(capitalUtil.toFixed(1))}
                size={160}
                strokeColor={{
                  '0%': '#108ee9',
                  '100%': '#87d068',
                }}
                format={(p) => (
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{p}%</div>
                    <div style={{ fontSize: 11, color: '#999' }}>of Authorized</div>
                  </div>
                )}
              />
              <Row gutter={8} style={{ marginTop: 16 }}>
                <Col span={12}>
                  <Statistic title="Authorized" value={data?.bank_capital?.authorized_capital || 0}
                    precision={0} valueStyle={{ fontSize: 14 }}
                    formatter={(v) => formatCurrency(v)} />
                </Col>
                <Col span={12}>
                  <Statistic title="Paid-up" value={data?.total_paid_up_capital || 0}
                    precision={0} valueStyle={{ fontSize: 14 }}
                    formatter={(v) => formatCurrency(v)} />
                </Col>
              </Row>
            </div>
          </ChartCard>
        </Col>
      </Row>

      {/* ── Charts Row 2 ── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* Investor Category Pie */}
        <Col xs={24} md={12} lg={8}>
          <ChartCard title="Investor Categories">
            {categoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" outerRadius={90} innerRadius={45}
                    paddingAngle={3} dataKey="value" label={CustomPieLabel}>
                    {categoryData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <RTooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>No data yet</div>
            )}
          </ChartCard>
        </Col>

        {/* Shareholder Registration Trend */}
        <Col xs={24} md={12} lg={8}>
          <ChartCard title="Registration Trend" extra={<Tag color="green">Monthly</Tag>}>
            {registrationTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={registrationTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RTooltip />
                  <Bar dataKey="count" name="New Registrations" fill="#52c41a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>No data yet</div>
            )}
          </ChartCard>
        </Col>

        {/* Gender Distribution */}
        <Col xs={24} md={12} lg={8}>
          <ChartCard title="Demographics">
            <Row gutter={[8, 16]}>
              <Col span={12}>
                <Card size="small" style={{ background: '#fff1f0', borderRadius: 8, border: 'none' }}>
                  <Statistic title={<><GlobalOutlined /> Foreign</>} value={data?.foreign_nationals?.count || 0}
                    valueStyle={{ fontSize: 22, color: '#d32f2f' }} />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {formatCurrency(data?.foreign_nationals?.capital || 0)}
                  </Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {(data?.foreign_nationals?.percentage || 0).toFixed(1)}% of capital
                  </Text>
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" style={{ background: '#f6ffed', borderRadius: 8, border: 'none' }}>
                  <Statistic title={<><TeamOutlined /> Staff</>} value={data?.staff_count || 0}
                    valueStyle={{ fontSize: 22, color: '#52c41a' }} />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {data?.active_shareholders > 0
                      ? ((data.staff_count / data.active_shareholders) * 100).toFixed(1)
                      : 0}% of total
                  </Text>
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" style={{ background: '#fff7e6', borderRadius: 8, border: 'none' }}>
                  <Statistic title="Active" value={data?.active_shareholders || 0}
                    valueStyle={{ fontSize: 22, color: '#faad14' }} />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" style={{ background: '#fff1f0', borderRadius: 8, border: 'none' }}>
                  <Statistic title="Dormant" value={data?.dormant_shareholders || 0}
                    valueStyle={{ fontSize: 22, color: '#f5222d' }} />
                </Card>
              </Col>
            </Row>
            {genderData.length > 0 && (
              <ResponsiveContainer width="100%" height={100}>
                <PieChart>
                  <Pie data={genderData} cx="50%" cy="50%" outerRadius={40} innerRadius={25}
                    paddingAngle={5} dataKey="value">
                    {genderData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <RTooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </Col>
      </Row>

      {/* ── Charts Row 3 ── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* Dividend by Year Bar Chart */}
        <Col xs={24} lg={12}>
          <ChartCard title="Dividend Summary by Fiscal Year">
            {dividendByYear.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dividendByYear}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="fiscal_year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RTooltip formatter={(v) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="gross" name="Gross Dividend" fill="#d32f2f" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="tax" name="Tax Deducted" fill="#f5222d" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="collected" name="Collected" fill="#52c41a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="uncollected" name="Uncollected" fill="#faad14" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>No dividend data yet</div>
            )}
          </ChartCard>
        </Col>

        {/* Top 10 Shareholders */}
        <Col xs={24} lg={12}>
          <ChartCard title="Top 10 Shareholders" extra={<Tag color="gold">By Shares</Tag>}>
            {topShareholders.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topShareholders} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                  <RTooltip formatter={(v, name) => [name === 'total_invested' ? formatCurrency(v) : formatNumber(v), name === 'total_invested' ? 'Invested' : 'Shares']} />
                  <Bar dataKey="total_shares" name="Total Shares" fill="#722ed1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>No shareholder data yet</div>
            )}
          </ChartCard>
        </Col>
      </Row>

      {/* ── Breakdowns Row ── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* Subscription Status */}
        <Col xs={24} md={8}>
          <ChartCard title="Subscription Status">
            {subStatuses.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={subStatuses.map((s, i) => ({ name: s.status, value: s.count, fill: PIE_COLORS[i] }))}
                    cx="50%" cy="50%" outerRadius={75} innerRadius={40} paddingAngle={3} dataKey="value">
                    {subStatuses.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                  </Pie>
                  <RTooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#bbb' }}>No data</div>
            )}
          </ChartCard>
        </Col>

        {/* Transfer Types */}
        <Col xs={24} md={8}>
          <ChartCard title="Transfer Types">
            {transferTypes.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={transferTypes.map((t, i) => ({ name: t.type, value: t.count, fill: PIE_COLORS[(i + 2) % PIE_COLORS.length] }))}
                    cx="50%" cy="50%" outerRadius={75} innerRadius={40} paddingAngle={3} dataKey="value">
                    {transferTypes.map((_, i) => <Cell key={i} fill={PIE_COLORS[(i + 2) % PIE_COLORS.length]} />)}
                  </Pie>
                  <RTooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#bbb' }}>No data</div>
            )}
          </ChartCard>
        </Col>

        {/* Pending Approvals by Type */}
        <Col xs={24} md={8}>
          <ChartCard title="Pending Approvals">
            {pendingByType.length > 0 ? (
              <div style={{ padding: '16px 0' }}>
                {pendingByType.map((p, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 16px', marginBottom: 8,
                    background: '#fafafa', borderRadius: 8, borderLeft: `3px solid ${PIE_COLORS[i]}`,
                  }}>
                    <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{p.entity_type}</span>
                    <Badge count={p.count} style={{ backgroundColor: PIE_COLORS[i] }} />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#52c41a' }}>
                <CheckCircleOutlined style={{ fontSize: 32, marginBottom: 8 }} />
                <div>All caught up!</div>
              </div>
            )}
          </ChartCard>
        </Col>
      </Row>

      {/* ── Recent Activity Tables ── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <ChartCard title="Recent Investments" extra={<Tag>Last 5</Tag>}>
            <Table
              dataSource={recentInvestments}
              rowKey="id"
              size="small"
              pagination={false}
              columns={[
                {
                  title: 'Shareholder', key: 'sh',
                  render: (_, r) => r.shareholder
                    ? <Text strong>{r.shareholder.first_name} {r.shareholder.last_name}</Text> : '-',
                },
                {
                  title: 'Date', dataIndex: 'payment_date', width: 100,
                  render: (d) => d ? dayjs(d).format('MMM DD') : '-',
                },
                {
                  title: 'Amount', dataIndex: 'amount',
                  render: (v) => <Text style={{ color: '#52c41a', fontWeight: 600 }}>{formatCurrency(v)}</Text>,
                },
                {
                  title: 'Status', dataIndex: 'approval_status', width: 90,
                  render: (s) => <Tag color={s === 'approved' ? 'green' : 'orange'}>{s}</Tag>,
                },
              ]}
            />
          </ChartCard>
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard title="Recent Transfers" extra={<Tag>Last 5</Tag>}>
            <Table
              dataSource={recentTransfers}
              rowKey="id"
              size="small"
              pagination={false}
              columns={[
                {
                  title: 'From', key: 'from',
                  render: (_, r) => r.transferor ? `${r.transferor.first_name} ${r.transferor.last_name}` : '-',
                },
                {
                  title: 'To', key: 'to',
                  render: (_, r) => r.transferee ? `${r.transferee.first_name} ${r.transferee.last_name}` : '-',
                },
                { title: 'Shares', dataIndex: 'number_of_shares', width: 80 },
                {
                  title: 'Status', dataIndex: 'approval_status', width: 90,
                  render: (s) => <Tag color={s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange'}>{s}</Tag>,
                },
              ]}
            />
          </ChartCard>
        </Col>
      </Row>
    </div>
  );
}
