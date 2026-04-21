import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, DatePicker, Space, Tag,
  message, Typography, Row, Col, Card, Statistic,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getAGMAttendance, createAGMAttendance, searchShareholders, getShareholders } from '../services/api';

const { Title } = Typography;

export default function AGM() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [year, setYear] = useState('');
  const [stats, setStats] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [shareholders, setShareholders] = useState([]);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getAGMAttendance({ page, page_size: 20, year });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
      setStats({ present: res.data.total_present, votingPower: res.data.total_voting_power });
    } catch { message.error('Failed to load'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page, year]);

  const handleSearch = async (val) => {
    if (!val || val.length < 1) return;
    try {
      const res = await searchShareholders(val);
      setShareholders((res.data.data || []).map(s => ({
        value: s.id, label: `${s.account_no} - ${s.first_name} ${s.last_name}`,
      })));
    } catch { setShareholders([]); }
  };

  const handleDropdownOpen = async (open) => {
    if (open && shareholders.length === 0) {
      try {
        const res = await getShareholders({ page: 1, page_size: 50 });
        setShareholders((res.data.data || []).map(s => ({
          value: s.id, label: `${s.account_no} - ${s.first_name} ${s.last_name}`,
        })));
      } catch { /* ignore */ }
    }
  };

  const handleSubmit = async (values) => {
    try {
      if (values.agm_date) values.agm_date = values.agm_date.toISOString();
      await createAGMAttendance(values);
      message.success('Attendance recorded');
      setModalOpen(false);
      form.resetFields();
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const columns = [
    { title: 'Shareholder', key: 'sh', render: (_, r) => r.shareholder ? `${r.shareholder.first_name} ${r.shareholder.last_name}` : '-' },
    { title: 'AGM Year', dataIndex: 'agm_year', width: 100 },
    { title: 'Date', dataIndex: 'agm_date', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
    { title: 'Type', dataIndex: 'attendance_type', render: (t) => <Tag color={t === 'in_person' ? 'blue' : 'purple'}>{t}</Tag> },
    { title: 'Proxy Name', dataIndex: 'proxy_name' },
    { title: 'Shares', dataIndex: 'number_of_shares' },
    { title: 'Present', key: 'present', render: (_, r) => <Tag color={r.is_present ? 'green' : 'red'}>{r.is_present ? 'Yes' : 'No'}</Tag> },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>AGM Attendance</Title>
        <Space>
          <Input placeholder="Filter by year" style={{ width: 150 }} onChange={(e) => setYear(e.target.value)} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalOpen(true); }}>
            Record Attendance
          </Button>
        </Space>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}><Card><Statistic title="Total Present" value={stats.present || 0} /></Card></Col>
        <Col span={8}><Card><Statistic title="Total Voting Power" value={stats.votingPower || 0} precision={4} /></Card></Col>
        <Col span={8}><Card><Statistic title="Total Records" value={total} /></Card></Col>
      </Row>

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }} />

      <Modal title="Record AGM Attendance" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="shareholder_id" label="Shareholder" rules={[{ required: true }]}>
            <Select showSearch filterOption={false} onSearch={handleSearch} options={shareholders}
              onDropdownVisibleChange={handleDropdownOpen}
              placeholder="Search shareholder..." />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="agm_date" label="AGM Date">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="agm_year" label="AGM Year" rules={[{ required: true }]}>
                <Input placeholder="e.g. 2024" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="attendance_type" label="Type" rules={[{ required: true }]}>
            <Select options={[
              { value: 'in_person', label: 'In Person' },
              { value: 'proxy', label: 'Proxy' },
            ]} />
          </Form.Item>
          <Form.Item name="proxy_name" label="Proxy Name">
            <Input />
          </Form.Item>
          <Form.Item name="remark" label="Remark">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">Record</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
