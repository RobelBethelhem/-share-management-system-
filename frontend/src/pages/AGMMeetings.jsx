import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, DatePicker, Select, Space, Tag, message,
  Typography, Row, Col, Popconfirm, Card, Statistic, Tabs, Progress, Badge, Descriptions, Empty,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, TeamOutlined, BarChartOutlined,
  CheckCircleOutlined, CloseCircleOutlined, PlayCircleOutlined, StopOutlined,
  CalendarOutlined, FileTextOutlined, PieChartOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  createMeeting, getMeetingsApi, updateMeeting, deleteMeeting,
  createAgendaApi, getAgendasApi, updateAgendaApi, deleteAgendaApi,
  activateAgendaApi, closeAgendaApi, getAGMAnalytics, getAGMAttendanceList,
} from '../services/api';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { TabPane } = Tabs;

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
const STATUS_COLORS = { upcoming: 'blue', active: 'green', closed: 'default' };
const AGENDA_STATUS_COLORS = { inactive: 'default', active: 'green', closed: 'red' };

function MeetingStatusTag({ status }) {
  return <Tag color={STATUS_COLORS[status] || 'default'}>{(status || '').toUpperCase()}</Tag>;
}

function AgendaStatusTag({ status }) {
  if (status === 'active') {
    return (
      <Badge status="processing" color="green" text={<Tag color="green">ACTIVE</Tag>} />
    );
  }
  return <Tag color={AGENDA_STATUS_COLORS[status] || 'default'}>{(status || '').toUpperCase()}</Tag>;
}

// ---------------------------------------------------------------------------
// Share-weighted vote Progress component
// ---------------------------------------------------------------------------
function VoteProgress({ label, percent, color, count }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <Row justify="space-between" align="middle">
        <Text style={{ fontSize: 13 }}>{label}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{count != null ? `${count} votes` : ''}</Text>
      </Row>
      <Progress
        percent={Number((percent || 0).toFixed(2))}
        strokeColor={color}
        format={(p) => `${p}%`}
        size="small"
      />
    </div>
  );
}

// ===========================================================================
// Main component
// ===========================================================================
export default function AGMMeetings() {
  // ---- meetings list state ----
  const [meetings, setMeetings] = useState([]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState(null);
  const [meetingForm] = Form.useForm();

  // ---- detail view state ----
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [activeTab, setActiveTab] = useState('agendas');

  // ---- agendas ----
  const [agendas, setAgendas] = useState([]);
  const [loadingAgendas, setLoadingAgendas] = useState(false);
  const [agendaModalOpen, setAgendaModalOpen] = useState(false);
  const [editingAgenda, setEditingAgenda] = useState(null);
  const [agendaForm] = Form.useForm();

  // ---- attendance ----
  const [attendance, setAttendance] = useState([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);

  // ---- analytics ----
  const [analytics, setAnalytics] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // auto-refresh ref
  const analyticsIntervalRef = useRef(null);

  // =========================================================================
  // Data fetchers
  // =========================================================================
  const fetchMeetings = useCallback(async () => {
    setLoadingMeetings(true);
    try {
      const res = await getMeetingsApi();
      setMeetings(Array.isArray(res.data.data) ? res.data.data : []);
    } catch {
      message.error('Failed to load meetings');
    }
    setLoadingMeetings(false);
  }, []);

  const fetchAgendas = useCallback(async (meetingId) => {
    if (!meetingId) return;
    setLoadingAgendas(true);
    try {
      const res = await getAgendasApi(meetingId);
      setAgendas(Array.isArray(res.data.data) ? res.data.data : []);
    } catch {
      message.error('Failed to load agendas');
    }
    setLoadingAgendas(false);
  }, []);

  const fetchAttendance = useCallback(async (meetingId) => {
    if (!meetingId) return;
    setLoadingAttendance(true);
    try {
      const res = await getAGMAttendanceList(meetingId);
      setAttendance(Array.isArray(res.data.data) ? res.data.data : []);
    } catch {
      message.error('Failed to load attendance');
    }
    setLoadingAttendance(false);
  }, []);

  const fetchAnalytics = useCallback(async (meetingId) => {
    if (!meetingId) return;
    setLoadingAnalytics(true);
    try {
      const res = await getAGMAnalytics(meetingId);
      setAnalytics(res.data.data || res.data || null);
    } catch {
      message.error('Failed to load analytics');
    }
    setLoadingAnalytics(false);
  }, []);

  // =========================================================================
  // Effects
  // =========================================================================
  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  // When a meeting is selected, load its child data
  useEffect(() => {
    if (selectedMeeting) {
      fetchAgendas(selectedMeeting.id);
      fetchAttendance(selectedMeeting.id);
      fetchAnalytics(selectedMeeting.id);
    }
  }, [selectedMeeting, fetchAgendas, fetchAttendance, fetchAnalytics]);

  // Auto-refresh analytics every 5s when analytics tab is active
  useEffect(() => {
    if (analyticsIntervalRef.current) {
      clearInterval(analyticsIntervalRef.current);
      analyticsIntervalRef.current = null;
    }
    if (selectedMeeting && activeTab === 'analytics') {
      analyticsIntervalRef.current = setInterval(() => {
        fetchAnalytics(selectedMeeting.id);
      }, 5000);
    }
    return () => {
      if (analyticsIntervalRef.current) {
        clearInterval(analyticsIntervalRef.current);
        analyticsIntervalRef.current = null;
      }
    };
  }, [selectedMeeting, activeTab, fetchAnalytics]);

  // =========================================================================
  // Meeting CRUD handlers
  // =========================================================================
  const openCreateMeeting = () => {
    setEditingMeeting(null);
    meetingForm.resetFields();
    setMeetingModalOpen(true);
  };

  const openEditMeeting = (record) => {
    setEditingMeeting(record);
    meetingForm.setFieldsValue({
      ...record,
      date: record.meeting_date ? dayjs(record.meeting_date) : null,
      meeting_type: record.meeting_type || 'hybrid',
      access_code: record.access_code || '',
    });
    setMeetingModalOpen(true);
  };

  const handleMeetingSubmit = async (values) => {
    try {
      const payload = {
        ...values,
        meeting_date: values.date ? values.date.toISOString() : null,
      };
      if (editingMeeting) {
        await updateMeeting(editingMeeting.id, payload);
        message.success('Meeting updated');
        // If the selected meeting was the one edited, refresh it
        if (selectedMeeting && selectedMeeting.id === editingMeeting.id) {
          setSelectedMeeting({ ...selectedMeeting, ...payload });
        }
      } else {
        await createMeeting(payload);
        message.success('Meeting created');
      }
      setMeetingModalOpen(false);
      meetingForm.resetFields();
      fetchMeetings();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to save meeting');
    }
  };

  const handleDeleteMeeting = async (id) => {
    try {
      await deleteMeeting(id);
      message.success('Meeting deleted');
      if (selectedMeeting && selectedMeeting.id === id) {
        setSelectedMeeting(null);
      }
      fetchMeetings();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to delete meeting');
    }
  };

  const handleMeetingStatusChange = async (record, newStatus) => {
    try {
      await updateMeeting(record.id, { status: newStatus });
      message.success(`Meeting ${newStatus === 'active' ? 'activated' : 'closed'}`);
      fetchMeetings();
      if (selectedMeeting && selectedMeeting.id === record.id) {
        setSelectedMeeting({ ...record, status: newStatus });
      }
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to update status');
    }
  };

  // =========================================================================
  // Agenda CRUD handlers
  // =========================================================================
  const openCreateAgenda = () => {
    setEditingAgenda(null);
    agendaForm.resetFields();
    setAgendaModalOpen(true);
  };

  const openEditAgenda = (record) => {
    setEditingAgenda(record);
    agendaForm.setFieldsValue({
      title: record.title,
      description: record.description,
      sort_order: record.sort_order,
    });
    setAgendaModalOpen(true);
  };

  const handleAgendaSubmit = async (values) => {
    try {
      if (editingAgenda) {
        await updateAgendaApi(editingAgenda.id, values);
        message.success('Agenda updated');
      } else {
        await createAgendaApi(selectedMeeting.id, values);
        message.success('Agenda created');
      }
      setAgendaModalOpen(false);
      agendaForm.resetFields();
      fetchAgendas(selectedMeeting.id);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to save agenda');
    }
  };

  const handleDeleteAgenda = async (id) => {
    try {
      await deleteAgendaApi(id);
      message.success('Agenda deleted');
      fetchAgendas(selectedMeeting.id);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to delete agenda');
    }
  };

  const handleActivateAgenda = async (agendaId) => {
    try {
      await activateAgendaApi(agendaId);
      message.success('Agenda activated');
      fetchAgendas(selectedMeeting.id);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to activate agenda');
    }
  };

  const handleCloseAgenda = async (agendaId) => {
    try {
      await closeAgendaApi(agendaId);
      message.success('Agenda closed');
      fetchAgendas(selectedMeeting.id);
      fetchAnalytics(selectedMeeting.id);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to close agenda');
    }
  };

  // =========================================================================
  // Meetings table columns
  // =========================================================================
  const meetingColumns = [
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: 'Date',
      dataIndex: 'meeting_date',
      key: 'meeting_date',
      width: 130,
      render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-',
      sorter: (a, b) => dayjs(a.meeting_date).unix() - dayjs(b.meeting_date).unix(),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status) => <MeetingStatusTag status={status} />,
      filters: [
        { text: 'Upcoming', value: 'upcoming' },
        { text: 'Active', value: 'active' },
        { text: 'Closed', value: 'closed' },
      ],
      onFilter: (value, record) => record.status === value,
    },
    {
      title: 'Attendees',
      dataIndex: 'attendee_count',
      key: 'attendees',
      width: 100,
      align: 'center',
      render: (v) => v ?? '-',
    },
    {
      title: 'Agendas',
      dataIndex: 'agenda_count',
      key: 'agendas',
      width: 90,
      align: 'center',
      render: (v) => v ?? '-',
    },
    {
      title: 'Votes',
      dataIndex: 'vote_count',
      key: 'votes',
      width: 80,
      align: 'center',
      render: (v) => v ?? '-',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 320,
      render: (_, record) => (
        <Space size="small" wrap>
          <Button
            size="small"
            type="primary"
            icon={<FileTextOutlined />}
            onClick={() => {
              setSelectedMeeting(record);
              setActiveTab('agendas');
            }}
          >
            Manage
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => { e.stopPropagation(); openEditMeeting(record); }}
          />
          {record.status === 'upcoming' && (
            <Popconfirm
              title="Activate this meeting?"
              description="This will make the meeting live for voting."
              onConfirm={() => handleMeetingStatusChange(record, 'active')}
              okText="Activate"
            >
              <Button size="small" icon={<PlayCircleOutlined />} style={{ color: '#52c41a' }}>
                Activate
              </Button>
            </Popconfirm>
          )}
          {record.status === 'active' && (
            <Popconfirm
              title="Close this meeting?"
              description="No further votes will be accepted."
              onConfirm={() => handleMeetingStatusChange(record, 'closed')}
              okText="Close"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" icon={<StopOutlined />} danger>
                Close
              </Button>
            </Popconfirm>
          )}
          <Popconfirm
            title="Delete this meeting?"
            description="This action cannot be undone."
            onConfirm={() => handleDeleteMeeting(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // =========================================================================
  // Agenda table columns
  // =========================================================================
  const hasActiveAgenda = agendas.some((a) => a.status === 'active');

  const agendaColumns = [
    {
      title: 'Sort',
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 60,
      align: 'center',
      sorter: (a, b) => (a.sort_order || 0) - (b.sort_order || 0),
      defaultSortOrder: 'ascend',
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text) => text || <Text type="secondary">-</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (status) => <AgendaStatusTag status={status} />,
    },
    {
      title: 'Total Votes',
      key: 'total_votes',
      width: 100,
      align: 'center',
      render: (_, record) => {
        const total = (record.agree_count || 0) + (record.disagree_count || 0) + (record.neutral_count || 0);
        return total;
      },
    },
    {
      title: 'Agree %',
      key: 'agree_pct',
      width: 100,
      render: (_, record) => {
        const totalShares = (record.agree_shares || 0) + (record.disagree_shares || 0) + (record.neutral_shares || 0);
        const pct = totalShares > 0 ? (record.agree_shares / totalShares) * 100 : 0;
        return (
          <Progress
            percent={Number(pct.toFixed(1))}
            size="small"
            strokeColor="#52c41a"
            format={(p) => `${p}%`}
          />
        );
      },
    },
    {
      title: 'Disagree %',
      key: 'disagree_pct',
      width: 100,
      render: (_, record) => {
        const totalShares = (record.agree_shares || 0) + (record.disagree_shares || 0) + (record.neutral_shares || 0);
        const pct = totalShares > 0 ? (record.disagree_shares / totalShares) * 100 : 0;
        return (
          <Progress
            percent={Number(pct.toFixed(1))}
            size="small"
            strokeColor="#f5222d"
            format={(p) => `${p}%`}
          />
        );
      },
    },
    {
      title: 'Neutral %',
      key: 'neutral_pct',
      width: 100,
      render: (_, record) => {
        const totalShares = (record.agree_shares || 0) + (record.disagree_shares || 0) + (record.neutral_shares || 0);
        const pct = totalShares > 0 ? (record.neutral_shares / totalShares) * 100 : 0;
        return (
          <Progress
            percent={Number(pct.toFixed(1))}
            size="small"
            strokeColor="#faad14"
            format={(p) => `${p}%`}
          />
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 260,
      render: (_, record) => (
        <Space size="small" wrap>
          {record.status === 'inactive' && (
            <Popconfirm
              title="Activate this agenda?"
              description={
                hasActiveAgenda
                  ? 'Warning: Another agenda is currently active and will be deactivated.'
                  : 'This will open this agenda for voting.'
              }
              onConfirm={() => handleActivateAgenda(record.id)}
              okText="Activate"
            >
              <Button size="small" icon={<PlayCircleOutlined />} style={{ color: '#52c41a' }}>
                Activate
              </Button>
            </Popconfirm>
          )}
          {record.status === 'active' && (
            <Popconfirm
              title="Close voting on this agenda?"
              description="No further votes will be accepted for this agenda."
              onConfirm={() => handleCloseAgenda(record.id)}
              okText="Close"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" icon={<StopOutlined />} danger>
                Close
              </Button>
            </Popconfirm>
          )}
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditAgenda(record)}
            disabled={record.status === 'active'}
          />
          <Popconfirm
            title="Delete this agenda?"
            description="This action cannot be undone."
            onConfirm={() => handleDeleteAgenda(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={record.status === 'active'}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // =========================================================================
  // Attendance table columns
  // =========================================================================
  const attendanceColumns = [
    {
      title: 'Shareholder Name',
      key: 'name',
      render: (_, record) => {
        const sh = record.shareholder || record;
        const firstName = sh.first_name || sh.shareholder_name || '';
        const lastName = sh.last_name || '';
        return `${firstName} ${lastName}`.trim() || '-';
      },
    },
    {
      title: 'Account No',
      key: 'account_no',
      render: (_, record) => record.shareholder?.account_no || record.account_no || '-',
    },
    {
      title: 'Shares',
      key: 'shares',
      align: 'right',
      render: (_, record) => {
        const shares = record.number_of_shares || record.shares || 0;
        return Number(shares).toLocaleString();
      },
    },
    {
      title: 'Voting Power %',
      key: 'voting_power',
      align: 'right',
      width: 130,
      render: (_, record) => {
        const vp = record.voting_power || record.voting_power_percent || 0;
        return `${Number(vp).toFixed(4)}%`;
      },
    },
    {
      title: 'Attendance Type',
      dataIndex: 'attendance_type',
      key: 'attendance_type',
      width: 140,
      render: (type) => (
        <Tag color={type === 'in_person' ? 'blue' : type === 'proxy' ? 'purple' : 'default'}>
          {type ? type.replace('_', ' ').toUpperCase() : '-'}
        </Tag>
      ),
    },
    {
      title: 'Time',
      key: 'time',
      width: 160,
      render: (_, record) => {
        const t = record.attended_at || record.created_at;
        return t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '-';
      },
    },
  ];

  // =========================================================================
  // Render: Analytics Tab content
  // =========================================================================
  const renderAnalytics = () => {
    if (!analytics) {
      return <Empty description="No analytics data available" />;
    }

    const {
      total_attendees = 0,
      attendance_percent = 0,
      shares_present_percent = 0,
      total_votes = 0,
      agendas: agendaResults = [],
    } = analytics;

    return (
      <div>
        {/* KPI cards */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={12} sm={6}>
            <Card>
              <Statistic
                title="Total Attendees"
                value={total_attendees}
                prefix={<TeamOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card>
              <Statistic
                title="Attendance %"
                value={Number(attendance_percent).toFixed(2)}
                suffix="%"
                prefix={<CheckCircleOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card>
              <Statistic
                title="Shares Present %"
                value={Number(shares_present_percent).toFixed(2)}
                suffix="%"
                prefix={<PieChartOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card>
              <Statistic
                title="Total Votes"
                value={total_votes}
                prefix={<BarChartOutlined />}
              />
            </Card>
          </Col>
        </Row>

        {/* Per-agenda vote results */}
        {agendaResults.length === 0 ? (
          <Empty description="No agenda results yet" />
        ) : (
          <Row gutter={[16, 16]}>
            {agendaResults.map((agenda) => {
              const totalShares =
                (agenda.agree_shares || 0) + (agenda.disagree_shares || 0) + (agenda.neutral_shares || 0);
              const agreePercent = totalShares > 0 ? (agenda.agree_shares / totalShares) * 100 : 0;
              const disagreePercent = totalShares > 0 ? (agenda.disagree_shares / totalShares) * 100 : 0;
              const neutralPercent = totalShares > 0 ? (agenda.neutral_shares / totalShares) * 100 : 0;

              return (
                <Col xs={24} md={12} key={agenda.id}>
                  <Card
                    title={
                      <Space>
                        <FileTextOutlined />
                        <span>{agenda.title}</span>
                        <AgendaStatusTag status={agenda.status} />
                      </Space>
                    }
                    size="small"
                  >
                    <VoteProgress
                      label="Agree"
                      percent={agreePercent}
                      color="#52c41a"
                      count={agenda.agree_count || 0}
                    />
                    <VoteProgress
                      label="Disagree"
                      percent={disagreePercent}
                      color="#f5222d"
                      count={agenda.disagree_count || 0}
                    />
                    <VoteProgress
                      label="Neutral"
                      percent={neutralPercent}
                      color="#faad14"
                      count={agenda.neutral_count || 0}
                    />
                    <Row justify="end" style={{ marginTop: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Total share-weighted votes: {Number(totalShares).toLocaleString()} shares
                      </Text>
                    </Row>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </div>
    );
  };

  // =========================================================================
  // Render: Meeting Detail view
  // =========================================================================
  const renderMeetingDetail = () => {
    if (!selectedMeeting) return null;

    return (
      <div>
        {/* Back button */}
        <Button
          style={{ marginBottom: 16 }}
          onClick={() => {
            setSelectedMeeting(null);
            setAgendas([]);
            setAttendance([]);
            setAnalytics(null);
            setActiveTab('agendas');
          }}
        >
          &larr; Back to Meetings
        </Button>

        {/* Meeting info header */}
        <Card style={{ marginBottom: 16 }}>
          <Descriptions
            title={
              <Space>
                <CalendarOutlined />
                <span>{selectedMeeting.title}</span>
              </Space>
            }
            extra={
              <Space>
                {selectedMeeting.status === 'upcoming' && (
                  <Popconfirm
                    title="Activate this meeting?"
                    description="This will make the meeting live for voting."
                    onConfirm={() => handleMeetingStatusChange(selectedMeeting, 'active')}
                    okText="Activate"
                  >
                    <Button type="primary" icon={<PlayCircleOutlined />}>
                      Activate Meeting
                    </Button>
                  </Popconfirm>
                )}
                {selectedMeeting.status === 'active' && (
                  <Popconfirm
                    title="Close this meeting?"
                    description="No further votes will be accepted."
                    onConfirm={() => handleMeetingStatusChange(selectedMeeting, 'closed')}
                    okText="Close"
                    okButtonProps={{ danger: true }}
                  >
                    <Button danger icon={<StopOutlined />}>
                      Close Meeting
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            }
            column={{ xs: 1, sm: 2, md: 4 }}
          >
            <Descriptions.Item label="Date">
              {selectedMeeting.meeting_date ? dayjs(selectedMeeting.meeting_date).format('YYYY-MM-DD') : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              <MeetingStatusTag status={selectedMeeting.status} />
            </Descriptions.Item>
            <Descriptions.Item label="Description" span={2}>
              {selectedMeeting.description || <Text type="secondary">No description</Text>}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        {/* Tabs */}
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <TabPane
            tab={
              <span>
                <FileTextOutlined />
                Agendas
              </span>
            }
            key="agendas"
          >
            <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
              <Text type="secondary">{agendas.length} agenda(s)</Text>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreateAgenda}
              >
                New Agenda
              </Button>
            </Row>
            {hasActiveAgenda && (
              <div style={{
                background: '#e6f7e6',
                border: '1px solid #b7eb8f',
                borderRadius: 6,
                padding: '8px 16px',
                marginBottom: 16,
              }}>
                <Text>
                  <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                  An agenda is currently <strong>active</strong> for voting. Only one agenda can be active at a time.
                  Activating another will deactivate the current one.
                </Text>
              </div>
            )}
            <Table
              dataSource={agendas}
              columns={agendaColumns}
              rowKey="id"
              loading={loadingAgendas}
              size="small"
              pagination={false}
              scroll={{ x: 1000 }}
            />
          </TabPane>

          <TabPane
            tab={
              <span>
                <TeamOutlined />
                Attendance
              </span>
            }
            key="attendance"
          >
            <Card size="small" style={{ marginBottom: 16 }}>
              <Statistic
                title="Total Attendees"
                value={attendance.length}
                prefix={<TeamOutlined />}
              />
            </Card>
            <Table
              dataSource={attendance}
              columns={attendanceColumns}
              rowKey={(record) => record.id || record.shareholder_id || Math.random()}
              loading={loadingAttendance}
              size="small"
              pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `Total ${t} attendees` }}
              scroll={{ x: 800 }}
            />
          </TabPane>

          <TabPane
            tab={
              <span>
                <BarChartOutlined />
                Analytics
              </span>
            }
            key="analytics"
          >
            {loadingAnalytics && !analytics ? (
              <div style={{ textAlign: 'center', padding: 48 }}>
                <Text type="secondary">Loading analytics...</Text>
              </div>
            ) : (
              renderAnalytics()
            )}
            <Row justify="end" style={{ marginTop: 16 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {activeTab === 'analytics' ? 'Auto-refreshing every 5 seconds' : ''}
              </Text>
            </Row>
          </TabPane>
        </Tabs>
      </div>
    );
  };

  // =========================================================================
  // Render: Meetings List view
  // =========================================================================
  const renderMeetingsList = () => (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>AGM Management</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateMeeting}>
          New Meeting
        </Button>
      </Row>
      <Table
        dataSource={meetings}
        columns={meetingColumns}
        rowKey="id"
        loading={loadingMeetings}
        size="small"
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `Total ${t} meetings` }}
        scroll={{ x: 1000 }}
      />
    </div>
  );

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <div>
      {selectedMeeting ? renderMeetingDetail() : renderMeetingsList()}

      {/* Meeting Create/Edit Modal */}
      <Modal
        title={editingMeeting ? 'Edit Meeting' : 'Create Meeting'}
        open={meetingModalOpen}
        onCancel={() => { setMeetingModalOpen(false); meetingForm.resetFields(); }}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={meetingForm}
          layout="vertical"
          onFinish={handleMeetingSubmit}
          initialValues={{ status: 'upcoming' }}
        >
          <Form.Item
            name="title"
            label="Title"
            rules={[{ required: true, message: 'Please enter a meeting title' }]}
          >
            <Input placeholder="e.g. Annual General Meeting 2026" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={3} placeholder="Meeting description (optional)" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="date"
                label="Date"
                rules={[{ required: true, message: 'Please select a date' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="status"
                label="Status"
                rules={[{ required: true, message: 'Please select a status' }]}
              >
                <Select
                  options={[
                    { value: 'upcoming', label: 'Upcoming' },
                    { value: 'active', label: 'Active' },
                    { value: 'closed', label: 'Closed' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="meeting_type" label="Meeting Type" initialValue="hybrid">
                <Select
                  options={[
                    { value: 'in_person', label: 'In-Person Only' },
                    { value: 'hybrid', label: 'Hybrid (In-Person + Virtual)' },
                    { value: 'virtual', label: 'Virtual Only' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="access_code" label="Meeting Hall Code"
                tooltip="6-digit code shareholders must enter for in-person attendance verification">
                <Input placeholder="e.g. 123456" maxLength={6} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => { setMeetingModalOpen(false); meetingForm.resetFields(); }}>
                Cancel
              </Button>
              <Button type="primary" htmlType="submit">
                {editingMeeting ? 'Update' : 'Create'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Agenda Create/Edit Modal */}
      <Modal
        title={editingAgenda ? 'Edit Agenda' : 'Create Agenda'}
        open={agendaModalOpen}
        onCancel={() => { setAgendaModalOpen(false); agendaForm.resetFields(); }}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={agendaForm}
          layout="vertical"
          onFinish={handleAgendaSubmit}
          initialValues={{ sort_order: (agendas.length + 1) }}
        >
          <Form.Item
            name="title"
            label="Title"
            rules={[{ required: true, message: 'Please enter an agenda title' }]}
          >
            <Input placeholder="e.g. Approval of Financial Statements" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={3} placeholder="Agenda description (optional)" />
          </Form.Item>
          <Form.Item
            name="sort_order"
            label="Sort Order"
            rules={[{ required: true, message: 'Please enter a sort order' }]}
          >
            <Input type="number" min={1} placeholder="Display order (e.g. 1, 2, 3)" />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => { setAgendaModalOpen(false); agendaForm.resetFields(); }}>
                Cancel
              </Button>
              <Button type="primary" htmlType="submit">
                {editingAgenda ? 'Update' : 'Create'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
