import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Tag, message, Typography, Row, Space, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getCapitalIncreases, createCapitalIncrease, deleteCapitalIncrease } from '../services/api';
import { formatNumber } from '../utils/format';

const { Title } = Typography;

const STATUS_COLORS = {
  draft: 'default',
  round_open: 'blue',
  additional_open: 'orange',
  closed: 'green',
};

export default function CapitalIncreases() {
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getCapitalIncreases();
      setData(res.data.data || []);
    } catch {
      message.error('Failed to load capital increases');
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async (values) => {
    try {
      await createCapitalIncrease(values);
      message.success('Capital increase created');
      setModalOpen(false);
      form.resetFields();
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteCapitalIncrease(id);
      message.success('Capital increase deleted');
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const columns = [
    { title: 'Label', dataIndex: 'label', render: (v, r) => <a onClick={() => navigate(`/capital-increases/${r.id}`)}>{v}</a> },
    { title: 'Total Shares', dataIndex: 'total_new_shares', render: (v) => formatNumber(v) },
    { title: 'Par Value', dataIndex: 'par_value', render: (v) => formatNumber(v) },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={STATUS_COLORS[s] || 'default'}>{s.replace('_', ' ')}</Tag> },
    { title: 'Round', dataIndex: 'current_round', render: (v, r) => `${v} / ${r.max_auto_rounds}` },
    { title: 'Allocated', dataIndex: 'allocated_shares', render: (v) => formatNumber(v) },
    { title: 'Remaining', key: 'remaining', render: (_, r) => formatNumber(r.total_new_shares - r.allocated_shares) },
    { title: 'Started', dataIndex: 'started_at', render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
    { title: 'Actions', key: 'actions', width: 100,
      render: (_, r) => (
        <Popconfirm
          title="Delete this capital increase?"
          description="All pre-subscriptions, confirmations, allocations, and additional requests for this campaign will be removed. This cannot be undone."
          okText="Delete"
          okButtonProps={{ danger: true }}
          onConfirm={(e) => { e?.stopPropagation?.(); handleDelete(r.id); }}
          onCancel={(e) => e?.stopPropagation?.()}
        >
          <Button size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()}>
            Delete
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Capital Increase Campaigns</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          New Capital Increase
        </Button>
      </Row>

      <Table
        dataSource={data}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 20 }}
        onRow={(r) => ({ onClick: (e) => { if (e.target.tagName !== 'A') navigate(`/capital-increases/${r.id}`); }, style: { cursor: 'pointer' } })}
      />

      <Modal
        title="Create Capital Increase"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="label" label="Label" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g., CI-2026-Q1" />
          </Form.Item>
          <Form.Item name="total_new_shares" label="Total New Shares" rules={[{ required: true, message: 'Required' }]}>
            <InputNumber min={1} style={{ width: '100%' }} placeholder="e.g., 1000" />
          </Form.Item>
          <Form.Item name="par_value" label="Par Value per Share (ETB)" rules={[{ required: true, message: 'Required' }]}>
            <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} placeholder="e.g., 10.00" />
          </Form.Item>
          <Form.Item name="max_auto_rounds" label="Max Auto Rounds" initialValue={3} tooltip="How many proportional rounds before the Additional Request phase opens">
            <InputNumber min={1} max={10} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="Remark">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">Create</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
