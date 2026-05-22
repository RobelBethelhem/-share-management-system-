import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Row, Col, Statistic, Button, Tag, Tabs, Table, Modal, message,
  Space, Typography, Popconfirm, Spin, InputNumber, Empty, Form, Alert, Input,
} from 'antd';
import {
  ArrowLeftOutlined, PlayCircleOutlined, EyeOutlined, CheckOutlined,
  RiseOutlined, CloseCircleOutlined, EditOutlined,
} from '@ant-design/icons';
import {
  getCapitalIncrease, getCISummary, getCISubscriptions, startCapitalIncrease,
  previewCIRound, runCIRound, confirmCISubscription, reverseCISubscription, closeCIRound,
  openCIAdditional, closeCapitalIncrease,
} from '../services/api';
import { formatNumber } from '../utils/format';

const { Title, Text } = Typography;

const STATUS_COLORS = {
  draft: 'default',
  round_open: 'blue',
  additional_open: 'orange',
  closed: 'green',
};

// ConfirmForm is the body of the confirmation modal. It owns its own form
// instance so each modal open is fully isolated — the parent passes a key
// based on the target row, which forces a fresh mount per row and removes
// any chance of state bleeding across opens. (Earlier we shared a parent
// form instance and called setFieldsValue before the Form had mounted; that
// works on the FIRST open but is unreliable on subsequent opens — the
// InputNumber would render with the offered value but the user's edit
// would not propagate, so Save would post the original full amount.)
function ConfirmForm({ target, onCancel, onFinish }) {
  const [form] = Form.useForm();
  const watchedConfirmed = Form.useWatch('confirmed_shares', form);
  const watchedAdditional = Form.useWatch('additional_requested', form);
  const offered = target.number_of_shares;
  const confirmedVal = watchedConfirmed == null ? offered : Number(watchedConfirmed);
  const safeConfirmed = isNaN(confirmedVal) ? 0 : confirmedVal;
  const unconfirmed = Math.max(0, offered - safeConfirmed);
  const additionalVal = watchedAdditional == null ? 0 : Number(watchedAdditional);
  const isPartial = safeConfirmed > 0 && safeConfirmed < offered;
  const isDecline = safeConfirmed === 0;

  const previewType = isDecline ? 'warning' : isPartial ? 'warning' : 'success';
  const previewMessage = isDecline
    ? `Declining — all ${offered} offered shares return to the pool for the next round.`
    : isPartial
      ? `Partial confirmation — ${safeConfirmed} of ${offered} accepted, ${unconfirmed} returns to the pool.`
      : `Full confirmation — all ${offered} shares accepted.`;
  const additionalNote = additionalVal > 0
    ? `Plus an additional request of ${additionalVal} share${additionalVal === 1 ? '' : 's'} — caps this shareholder's allocation in the next round.`
    : null;

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={onFinish}
      initialValues={{
        confirmed_shares: offered,
        additional_requested: 0,
        note: '',
      }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={`Offered in Round ${target.round}: ${offered} shares`}
        description="Enter the amount the shareholder confirms (0 to decline). Optionally record an additional request — that amount caps their allocation in the next round."
      />
      <Form.Item
        name="confirmed_shares"
        label="Confirmed shares"
        rules={[{ required: true, message: 'Required' }]}
        tooltip={`Must be between 0 and ${offered}`}
      >
        <InputNumber
          min={0}
          max={offered}
          style={{ width: '100%' }}
          placeholder={`0..${offered}`}
        />
      </Form.Item>
      <Form.Item
        name="additional_requested"
        label="Additional shares requested (optional)"
        tooltip="If the shareholder wants more shares than offered, enter the extra amount here. It will be the cap for their next-round allocation."
      >
        <InputNumber min={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="note" label="Note (optional)">
        <Input.TextArea rows={2} placeholder="e.g., signed paper form received on..." />
      </Form.Item>
      <Alert
        type={previewType}
        showIcon
        style={{ marginBottom: 12 }}
        message={previewMessage}
        description={additionalNote}
      />
      <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
        <Space>
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="primary" htmlType="submit" icon={<CheckOutlined />}>Save</Button>
        </Space>
      </Form.Item>
    </Form>
  );
}

export default function CapitalIncreaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [ci, setCi] = useState(null);
  const [summary, setSummary] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [subsByRound, setSubsByRound] = useState({});
  const [additionalRequests, setAdditionalRequests] = useState([]);
  const [activeTab, setActiveTab] = useState('1');
  const [loading, setLoading] = useState(true);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewRound, setPreviewRound] = useState(1);

  // Per-row confirmation modal: shareholder declares confirmed amount + optional additional request.
  // The form instance lives INSIDE ConfirmForm (one per mount), so opening the
  // modal for a different row gives a totally fresh form. No shared state to leak.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null); // the pre-sub row being confirmed

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [detailRes, summaryRes] = await Promise.all([
        getCapitalIncrease(id),
        getCISummary(id),
      ]);
      const detail = detailRes.data;
      setCi(detail.data);
      setRounds(detail.rounds || []);
      setSummary(summaryRes.data);
      setAdditionalRequests(detail.additional_requests || []);

      const subsRes = await getCISubscriptions(id);
      const map = {};
      (subsRes.data.data || []).forEach((s) => {
        const r = s.round || 0;
        if (!map[r]) map[r] = [];
        map[r].push(s);
      });
      setSubsByRound(map);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to load capital increase');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleStart = async () => {
    try {
      await startCapitalIncrease(id);
      message.success('Capital increase started');
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handlePreview = async (round) => {
    setPreviewRound(round);
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const res = await previewCIRound(id, round);
      setPreviewData(res.data);
    } catch (err) {
      message.error(err.response?.data?.error || 'Preview failed');
      setPreviewOpen(false);
    }
    setPreviewLoading(false);
  };

  const handleRunRound = async (round) => {
    try {
      await runCIRound(id, round);
      message.success(`Round ${round} executed`);
      setPreviewOpen(false);
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Run failed');
    }
  };

  const openConfirmModal = (row) => {
    setConfirmTarget(row);
    setConfirmOpen(true);
    // ConfirmForm reads target.number_of_shares via initialValues; we use a
    // key on the component so each open re-mounts a fresh Form/InputNumber.
  };

  const submitConfirm = async (values) => {
    if (!confirmTarget) return;
    try {
      await confirmCISubscription(id, confirmTarget.id, {
        confirmed_shares: Number(values.confirmed_shares ?? 0),
        additional_requested: Number(values.additional_requested ?? 0),
        note: values.note || '',
      });
      message.success('Confirmation recorded');
      setConfirmOpen(false);
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  // Decline shortcut: confirm 0 shares, no additional.
  const declineRow = async (row) => {
    try {
      await confirmCISubscription(id, row.id, { confirmed_shares: 0, additional_requested: 0 });
      message.success('Declined');
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  // Reverse: undo a confirm/decline so the pre-sub can be re-confirmed.
  // Drops the linked confirmation+allocation, deletes round-local
  // unfulfilled additional requests, and replays FIFO fulfillment.
  const reverseRow = async (row) => {
    try {
      await reverseCISubscription(id, row.id);
      message.success('Reversed — the pre-subscription is active again');
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleCloseRound = async (round) => {
    try {
      await closeCIRound(id, round);
      message.success(`Round ${round} closed`);
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleOpenAdditional = async () => {
    try {
      await openCIAdditional(id);
      message.success('Additional-request phase opened');
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleCloseCI = async () => {
    try {
      await closeCapitalIncrease(id);
      message.success('Capital increase closed');
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  if (loading || !ci) return <Spin style={{ display: 'block', marginTop: 100 }} />;

  const remaining = summary?.remaining ?? (ci.total_new_shares - ci.allocated_shares);
  const nextRound = Math.min(ci.current_round + 1, ci.max_auto_rounds);
  const isActive = ci.status === 'round_open' || ci.status === 'additional_open';
  const canRunNext = isActive && ci.current_round < ci.max_auto_rounds && remaining > 0;
  const canOpenAdditional = ci.status === 'round_open' && remaining > 0;
  const canClose = ci.status !== 'closed' && ci.status !== 'draft';

  // Pending additional requests across all rounds — used to nudge the admin
  // toward proportional auto-distribution instead of manual approval.
  const pendingRequests = additionalRequests.filter((r) => r.status === 'pending' || r.status === 'partial');
  const pendingTotal = pendingRequests.reduce((sum, r) => sum + (r.requested_shares - r.fulfilled_shares), 0);

  // ---- per-round statistics, reconstructed from stored data ----
  const roundStats = (R) => {
    const presubs = (subsByRound[R] || []).filter((s) => s.type === 'pre-subscription');
    const confs = (subsByRound[R] || []).filter((s) => s.type === 'confirmation' || s.type === 'additional');
    // Pool entering round R = total - confirmed in earlier rounds.
    let confirmedBefore = 0;
    for (let r = 1; r < R; r++) {
      const earlier = (subsByRound[r] || []).filter((s) => s.type === 'confirmation' || s.type === 'additional');
      confirmedBefore += earlier.reduce((s, c) => s + (c.number_of_shares || 0), 0);
    }
    const pool = (ci.total_new_shares || 0) - confirmedBefore;
    const totalBasis = presubs.reduce((s, p) => s + (p.base_shares || 0), 0);
    const offered = presubs.reduce((s, p) => s + (p.number_of_shares || 0), 0);
    const confirmed = confs.reduce((s, c) => s + (c.number_of_shares || 0), 0);
    const declined = presubs.filter((p) => p.status === 'declined').length;
    const expired = presubs.filter((p) => p.status === 'expired').length;
    const pending = presubs.filter((p) => !p.shareholder_confirmed_at && p.status !== 'expired' && p.status !== 'declined').length;
    const addReqsHere = additionalRequests.filter((r) => r.round === R);
    const addReqsTotal = addReqsHere.reduce((s, r) => s + (r.requested_shares || 0), 0);
    return { pool, totalBasis, offered, confirmed, declined, expired, pending, addReqsCount: addReqsHere.length, addReqsTotal };
  };

  const activeRoundNum = Number(activeTab);
  const hasActiveRound = rounds.some((r) => r.round === activeRoundNum);
  const statsForActive = hasActiveRound ? roundStats(activeRoundNum) : null;

  const buildRoundTab = (roundNum) => {
    const presubs = (subsByRound[roundNum] || []).filter((s) => s.type === 'pre-subscription');
    const confirmations = (subsByRound[roundNum] || []).filter((s) => s.type === 'confirmation');
    // shareholder_id → confirmation row (one per shareholder per round)
    const confirmByShID = {};
    confirmations.forEach((c) => { confirmByShID[c.shareholder_id] = c; });
    // shareholder_id → sum of additional shares requested during THIS round's confirmation phase
    const additionalByShID = {};
    additionalRequests.filter((r) => r.round === roundNum).forEach((r) => {
      additionalByShID[r.shareholder_id] = (additionalByShID[r.shareholder_id] || 0) + r.requested_shares;
    });

    const rowStatus = (r) => {
      const conf = confirmByShID[r.shareholder_id];
      if (r.status === 'declined') return { color: 'volcano', label: 'Declined' };
      if (r.status === 'expired')  return { color: 'red',     label: 'Expired' };
      if (conf) {
        if (conf.number_of_shares < r.number_of_shares) return { color: 'gold', label: 'Partial' };
        return { color: 'green', label: 'Confirmed' };
      }
      return { color: 'orange', label: 'Pre-subscription' };
    };

    const columns = [
      { title: 'Sh. ID', key: 'shid', width: 75, render: (_, r) => r.shareholder_id ?? r.shareholder?.id ?? '-' },
      { title: 'Shareholder', key: 'sh',
        render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : `#${r.shareholder_id}` },
      { title: 'Account', key: 'acc', render: (_, r) => r.shareholder?.account_no || '-' },
      { title: 'Basis', dataIndex: 'base_shares', render: (v) => formatNumber(v) },
      { title: 'Offered', dataIndex: 'number_of_shares', render: (v) => <Text strong>{formatNumber(v)}</Text> },
      { title: 'Confirmed', key: 'confirmed',
        render: (_, r) => {
          const conf = confirmByShID[r.shareholder_id];
          if (conf) {
            const color = conf.number_of_shares < r.number_of_shares ? '#fa8c16' : '#3f8600';
            return <Text strong style={{ color }}>{formatNumber(conf.number_of_shares)}</Text>;
          }
          if (r.status === 'declined') return <Text type="secondary">0 (declined)</Text>;
          if (r.status === 'expired')  return <Text type="secondary">— (expired)</Text>;
          return <Text type="secondary">pending</Text>;
        } },
      { title: 'Additional Requested', key: 'addreq',
        render: (_, r) => {
          const a = additionalByShID[r.shareholder_id] || 0;
          return a > 0 ? <Text style={{ color: '#1677ff' }}>+{formatNumber(a)}</Text> : <Text type="secondary">—</Text>;
        } },
      { title: 'Status', key: 'st',
        render: (_, r) => { const s = rowStatus(r); return <Tag color={s.color}>{s.label}</Tag>; } },
      { title: 'Actions', key: 'a',
        render: (_, r) => {
          const conf = confirmByShID[r.shareholder_id];
          const acted = !!conf || r.status === 'expired' || r.status === 'declined' || !!r.shareholder_confirmed_at;
          if (acted) {
            return (
              <Popconfirm
                title="Reverse this action?"
                description="Deletes the confirmation/allocation, removes unfulfilled additional requests created during this round, and resets the pre-subscription so you can confirm again."
                okText="Reverse"
                okButtonProps={{ danger: true }}
                onConfirm={() => reverseRow(r)}
              >
                <Button size="small" type="link" danger>Reverse</Button>
              </Popconfirm>
            );
          }
          return (
            <Space>
              <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => openConfirmModal(r)}>
                Confirm
              </Button>
              <Popconfirm title="Decline this offer? Their shares will return to the pool." onConfirm={() => declineRow(r)}>
                <Button size="small" danger>Decline</Button>
              </Popconfirm>
            </Space>
          );
        } },
    ];

    const stats = roundStats(roundNum);

    return (
      <>
        <Space style={{ marginBottom: 12 }}>
          <Popconfirm title={`Close Round ${roundNum}? Unconfirmed pre-subscriptions will be expired.`} onConfirm={() => handleCloseRound(roundNum)}>
            <Button>Close Round {roundNum}</Button>
          </Popconfirm>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Pool {formatNumber(stats.pool)} · Basis {formatNumber(stats.totalBasis)} · Offered {formatNumber(stats.offered)} · Confirmed {formatNumber(stats.confirmed)}
            {stats.declined > 0 && ` · ${stats.declined} declined`}
            {stats.pending > 0 && ` · ${stats.pending} pending`}
            {stats.addReqsCount > 0 && ` · ${stats.addReqsCount} additional req (${formatNumber(stats.addReqsTotal)} shares)`}
          </Text>
        </Space>
        {presubs.length === 0 ? <Empty description="No pre-subscriptions in this round" /> : (
          <Table
            dataSource={presubs}
            columns={columns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20 }}
            expandable={{
              expandedRowRender: (row) => {
                const conf = confirmByShID[row.shareholder_id];
                const exact = stats.totalBasis > 0 ? (stats.pool * row.base_shares) / stats.totalBasis : 0;
                const floor = Math.floor(exact);
                const frac = exact - floor;
                const uplift = (row.number_of_shares || 0) - floor;
                const myReqs = additionalRequests.filter((r) => r.shareholder_id === row.shareholder_id && r.round === roundNum);
                const note = conf?.remark || row.remark || '';
                return (
                  <div style={{ padding: '6px 24px', fontSize: 13 }}>
                    <Row gutter={24}>
                      <Col span={12}>
                        <Text strong>Allocation math (Round {roundNum})</Text>
                        <div style={{ fontFamily: 'monospace', marginTop: 6, lineHeight: 1.7 }}>
                          basis = <Text strong>{formatNumber(row.base_shares)}</Text>
                          <br />
                          exact = {formatNumber(stats.pool)} × {formatNumber(row.base_shares)} ÷ {formatNumber(stats.totalBasis)} ={' '}
                          <Text strong>{exact.toFixed(4)}</Text>
                          <br />
                          floor = <Text strong>{formatNumber(floor)}</Text>{' '}
                          <Text type="secondary">(fractional remainder {frac.toFixed(4)})</Text>
                          <br />
                          remainder uplift = <Text strong>{uplift > 0 ? `+${uplift}` : 0}</Text>
                          {uplift > 0 && <Text type="secondary"> (Hamilton tie-break)</Text>}
                          <br />
                          <Text strong style={{ color: '#d32f2f' }}>offered = {formatNumber(row.number_of_shares)}</Text>
                        </div>
                      </Col>
                      <Col span={12}>
                        <Text strong>Confirmation & follow-ups</Text>
                        <div style={{ marginTop: 6, lineHeight: 1.7 }}>
                          {conf ? (
                            <>
                              confirmed: <Text strong style={{ color: conf.number_of_shares < row.number_of_shares ? '#fa8c16' : '#3f8600' }}>
                                {formatNumber(conf.number_of_shares)}
                              </Text>{' '}
                              of {formatNumber(row.number_of_shares)}
                              {conf.number_of_shares < row.number_of_shares && (
                                <Text type="secondary"> — unconfirmed {formatNumber(row.number_of_shares - conf.number_of_shares)} returned to pool</Text>
                              )}
                            </>
                          ) : row.status === 'declined' ? (
                            <Text style={{ color: '#fa541c' }}>declined (full {formatNumber(row.number_of_shares)} returned to pool)</Text>
                          ) : row.status === 'expired' ? (
                            <Text type="secondary">expired (round closed without confirmation)</Text>
                          ) : (
                            <Text type="secondary">pending confirmation</Text>
                          )}
                          <br />
                          note: {note ? <Text>{note}</Text> : <Text type="secondary">—</Text>}
                          <br />
                          additional requested in this round:{' '}
                          {myReqs.length > 0 ? (
                            myReqs.map((r) => (
                              <span key={r.id} style={{ marginRight: 8 }}>
                                <Text strong style={{ color: '#1677ff' }}>+{formatNumber(r.requested_shares)}</Text>
                                {' '}<Tag color={r.status === 'fulfilled' ? 'green' : r.status === 'partial' ? 'gold' : r.status === 'rejected' ? 'red' : 'orange'} style={{ marginLeft: 4 }}>{r.status}</Tag>
                                {r.fulfilled_shares > 0 && (
                                  <Text type="secondary"> (fulfilled {formatNumber(r.fulfilled_shares)} of {formatNumber(r.requested_shares)})</Text>
                                )}
                              </span>
                            ))
                          ) : <Text type="secondary">—</Text>}
                        </div>
                      </Col>
                    </Row>
                  </div>
                );
              },
            }}
          />
        )}
      </>
    );
  };

  const tabItems = rounds.map((r) => ({
    key: String(r.round),
    label: `Round ${r.round}`,
    children: buildRoundTab(r.round),
  }));

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/capital-increases')}>Back</Button>
        <Title level={4} style={{ margin: 0 }}>{ci.label}</Title>
        <Tag color={STATUS_COLORS[ci.status] || 'default'} style={{ marginLeft: 8 }}>{ci.status.replace('_', ' ')}</Tag>
      </Space>

      {/* Compact campaign-level summary so global context is always visible */}
      <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 6, fontSize: 13 }}>
        <Space split="|" size={[16, 4]} wrap>
          <span>Campaign Total: <Text strong>{formatNumber(ci.total_new_shares)}</Text></span>
          <span>Allocated overall: <Text strong style={{ color: '#3f8600' }}>{formatNumber(ci.allocated_shares)}</Text></span>
          <span>Remaining: <Text strong style={{ color: '#cf1322' }}>{formatNumber(remaining)}</Text></span>
          <span>Current Round: <Text strong>{ci.current_round} / {ci.max_auto_rounds}</Text></span>
          <span>Par: <Text strong>{ci.par_value}</Text></span>
        </Space>
      </div>

      {/* Top cards reflect the selected round tab (or campaign overview if no round yet) */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {statsForActive ? (
          <>
            <Col xs={12} sm={6}>
              <Card><Statistic title={`Round ${activeRoundNum} Pool`} value={statsForActive.pool} /></Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card><Statistic title={`Round ${activeRoundNum} Total Basis`} value={statsForActive.totalBasis} /></Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card><Statistic title={`Offered in Round ${activeRoundNum}`} value={statsForActive.offered} /></Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title={`Confirmed in Round ${activeRoundNum}`}
                  value={statsForActive.confirmed}
                  valueStyle={{ color: '#3f8600' }}
                />
              </Card>
            </Col>
          </>
        ) : (
          <>
            <Col xs={12} sm={6}>
              <Card><Statistic title="Total New Shares" value={ci.total_new_shares} /></Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card><Statistic title="Allocated" value={ci.allocated_shares} valueStyle={{ color: '#3f8600' }} /></Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card><Statistic title="Remaining" value={remaining} valueStyle={{ color: '#cf1322' }} /></Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card><Statistic title="Current Round" value={`${ci.current_round} / ${ci.max_auto_rounds}`} /></Card>
            </Col>
          </>
        )}
      </Row>

      {canRunNext && pendingRequests.length > 0 && ci.current_round >= 1 && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message={`${pendingRequests.length} pending additional request${pendingRequests.length === 1 ? '' : 's'} totaling ${formatNumber(pendingTotal)} shares`}
          description={`Run Round ${nextRound} to distribute the remaining ${formatNumber(remaining)} shares proportionally. Each shareholder's allocation will be capped at their requested amount — no manual editing needed.`}
          action={
            <Popconfirm
              title={`Run Round ${nextRound}?`}
              description={`Hamilton allocation of ${formatNumber(remaining)} shares among shareholders with pending requests.`}
              onConfirm={() => handleRunRound(nextRound)}
            >
              <Button type="primary" icon={<PlayCircleOutlined />}>Run Round {nextRound}</Button>
            </Popconfirm>
          }
        />
      )}

      <Card title="Actions" size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {ci.status === 'draft' && (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleStart}>
              Start Campaign
            </Button>
          )}
          {canRunNext && (
            <>
              <Button icon={<EyeOutlined />} onClick={() => handlePreview(nextRound)}>
                Preview Round {nextRound}
              </Button>
              <Popconfirm title={`Run Round ${nextRound}? This will create pre-subscriptions for all eligible shareholders.`} onConfirm={() => handleRunRound(nextRound)}>
                <Button type="primary" icon={<PlayCircleOutlined />}>Run Round {nextRound}</Button>
              </Popconfirm>
            </>
          )}
          {canOpenAdditional && ci.current_round >= 1 && (
            <Popconfirm title="Switch to the manual approval phase? Auto-rounds will stop; admin approves each remaining request individually." onConfirm={handleOpenAdditional}>
              <Button icon={<RiseOutlined />}>Stop Auto-Rounds (Manual Approval)</Button>
            </Popconfirm>
          )}
          {canClose && (
            <Popconfirm title="Close this capital increase? No more activity will be allowed." onConfirm={handleCloseCI}>
              <Button danger icon={<CloseCircleOutlined />}>Close Capital Increase</Button>
            </Popconfirm>
          )}
        </Space>
      </Card>

      {rounds.length === 0 ? (
        <Empty description="No rounds have been run yet" />
      ) : (
        <Card>
          <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
        </Card>
      )}

      <Modal
        title={`Preview Round ${previewRound}`}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        width={1100}
        footer={[
          <Button key="cancel" onClick={() => setPreviewOpen(false)}>Cancel</Button>,
          <Popconfirm key="run" title={`Run Round ${previewRound} with these allocations?`} onConfirm={() => handleRunRound(previewRound)}>
            <Button type="primary">Run This Round</Button>
          </Popconfirm>,
        ]}
      >
        {previewLoading ? <Spin /> : previewData ? (
          <>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={6}><Statistic title="Pool" value={previewData.pool} /></Col>
              <Col span={6}><Statistic title="Total Basis" value={previewData.total_basis} /></Col>
              <Col span={6}><Statistic title="Will be allocated" value={previewData.allocated_in_round} /></Col>
              <Col span={6}><Statistic title="Round" value={previewData.round} /></Col>
            </Row>
            <div style={{ marginBottom: 12, padding: 12, background: '#fafafa', borderRadius: 6, fontFamily: 'monospace', fontSize: 13 }}>
              <Text strong>Formula per shareholder:</Text>{' '}
              {previewData.round >= 2
                ? 'Will Get = min(floor(Pool × Basis ÷ Total Basis) + Remainder Uplift, Request Cap)'
                : 'Will Get = floor(Pool × Basis ÷ Total Basis) + Remainder Uplift'}
              <br />
              <Text type="secondary">
                Round 1 basis = paid pre-CI shares. Round 2+ basis = paid pre-CI shares + paid shares from earlier rounds of this CI.
                Remainder Uplift = +1 share awarded to the largest fractional remainders (Hamilton method) so the round totals match the pool exactly.
                {previewData.round >= 2 && ' Round 2+ only includes shareholders with pending additional requests; each gets at most the remaining (requested − fulfilled) of those requests.'}
              </Text>
            </div>
            <Table
              dataSource={(previewData.entries || []).filter((e) => e.allocated_shares > 0 || e.base_shares > 0)}
              rowKey="shareholder_id"
              size="small"
              pagination={{ pageSize: 10 }}
              expandable={{
                expandedRowRender: (rec) => {
                  const bd = rec.breakdown || {};
                  const exact = Number(rec.exact_claim || 0);
                  const totalBasis = previewData.total_basis || 0;
                  const pool = previewData.pool || 0;
                  return (
                    <div style={{ padding: '4px 24px', fontSize: 13 }}>
                      <Row gutter={24}>
                        <Col span={11}>
                          <Text strong>Holdings breakdown</Text>
                          <ul style={{ marginTop: 6, marginBottom: 6, paddingLeft: 18 }}>
                            <li>Pre-CI allocations: <Text strong>{bd.allocation_count}</Text></li>
                            <li>Total owned (allocated): <Text strong>{formatNumber(bd.total_allocated_shares)}</Text></li>
                            <li>Paid (pre-CI): <Text strong style={{ color: '#3f8600' }}>{formatNumber(bd.paid_shares)}</Text></li>
                            <li>Unpaid (pre-CI): <Text strong style={{ color: '#cf1322' }}>{formatNumber(bd.unpaid_shares)}</Text></li>
                            {bd.ci_paid_shares > 0 && (
                              <li>Paid in earlier CI rounds: <Text strong style={{ color: '#1677ff' }}>{formatNumber(bd.ci_paid_shares)}</Text></li>
                            )}
                            <li>
                              <Text strong>Basis used = {formatNumber(bd.paid_shares)}
                                {bd.ci_paid_shares > 0 && ` + ${formatNumber(bd.ci_paid_shares)}`}
                                {' '}= {formatNumber(bd.total)}</Text>
                            </li>
                          </ul>
                        </Col>
                        <Col span={13}>
                          <Text strong>Will-Get formula</Text>
                          <div style={{ fontFamily: 'monospace', marginTop: 6, lineHeight: 1.7 }}>
                            exact = {formatNumber(pool)} × {formatNumber(bd.total)} ÷ {formatNumber(totalBasis)} ={' '}
                            <Text strong>{exact.toFixed(4)}</Text>
                            <br />
                            floor(exact) = <Text strong>{formatNumber(rec.floor_shares)}</Text>{' '}
                            <Text type="secondary">(fractional remainder: {Number(rec.frac || 0).toFixed(4)})</Text>
                            <br />
                            remainder uplift = <Text strong>{rec.remainder_uplift > 0 ? '+1' : '0'}</Text>{' '}
                            {rec.remainder_uplift > 0 && <Text type="secondary">(awarded by Hamilton tie-break)</Text>}
                            <br />
                            Hamilton result = <Text strong>{formatNumber(rec.floor_shares + (rec.remainder_uplift || 0))}</Text>
                            {rec.request_cap != null && (
                              <>
                                <br />
                                request cap = <Text strong>{formatNumber(rec.request_cap)}</Text>{' '}
                                {rec.cap_binds && <Text type="warning">(binds — excess returns to the pool)</Text>}
                              </>
                            )}
                            <br />
                            <Text strong style={{ color: '#d32f2f' }}>Will Get = {formatNumber(rec.allocated_shares)}</Text>
                          </div>
                        </Col>
                      </Row>
                    </div>
                  );
                },
              }}
              columns={[
                { title: 'Sh. ID', dataIndex: 'shareholder_id', width: 75 },
                { title: 'Shareholder', dataIndex: 'shareholder_name' },
                { title: 'Account', dataIndex: 'account_no' },
                { title: '# Allocs', dataIndex: ['breakdown', 'allocation_count'], width: 80 },
                { title: 'Owned', dataIndex: ['breakdown', 'total_allocated_shares'], render: (v) => formatNumber(v) },
                { title: 'Paid', dataIndex: ['breakdown', 'paid_shares'], render: (v) => <Text style={{ color: '#3f8600' }}>{formatNumber(v)}</Text> },
                { title: 'Unpaid', dataIndex: ['breakdown', 'unpaid_shares'], render: (v) => <Text style={{ color: '#cf1322' }}>{formatNumber(v)}</Text> },
                ...(previewData.round > 1 ? [{ title: 'CI Paid', dataIndex: ['breakdown', 'ci_paid_shares'], render: (v) => <Text style={{ color: '#1677ff' }}>{formatNumber(v)}</Text> }] : []),
                { title: 'Basis', dataIndex: 'base_shares', render: (v) => <Text strong>{formatNumber(v)}</Text> },
                ...(previewData.round >= 2 ? [{
                  title: 'Request Cap', key: 'cap',
                  render: (_, r) => {
                    if (r.request_cap == null) return <Text type="secondary">—</Text>;
                    return (
                      <Text style={{ color: r.cap_binds ? '#fa8c16' : '#1677ff' }}>
                        {formatNumber(r.request_cap)}{r.cap_binds ? ' (binds)' : ''}
                      </Text>
                    );
                  },
                }] : []),
                { title: 'Will Get', dataIndex: 'allocated_shares', render: (v) => <Text strong style={{ color: '#d32f2f' }}>{formatNumber(v)}</Text> },
              ]}
            />
          </>
        ) : <Empty />}
      </Modal>

      <Modal
        title={confirmTarget ? `Confirm — ${confirmTarget.shareholder ? `${confirmTarget.shareholder.first_name} ${confirmTarget.shareholder.last_name}` : `#${confirmTarget.shareholder_id}`}` : 'Confirm'}
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        footer={null}
        destroyOnClose
        width={560}
      >
        {confirmTarget && (
          <ConfirmForm
            key={confirmTarget.id}
            target={confirmTarget}
            onCancel={() => setConfirmOpen(false)}
            onFinish={submitConfirm}
          />
        )}
      </Modal>
    </div>
  );
}
