import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, DatePicker, Space, Tag,
  message, Typography, Row, Col, Popconfirm, Card, Descriptions, Alert,
} from 'antd';
import { PlusOutlined, ThunderboltOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getShareSplits, createShareSplit, updateShareSplit, processShareSplit } from '../services/api';

const { Title, Text } = Typography;

export default function ShareSplits() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getShareSplits();
      setData(res.data.data || []);
    } catch { message.error('Failed to load'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (values) => {
    try {
      if (values.split_date) values.split_date = values.split_date.toISOString();
      if (editing) {
        await updateShareSplit(editing.id, values);
        message.success('Updated');
      } else {
        await createShareSplit(values);
        message.success('Created');
      }
      setModalOpen(false);
      form.resetFields();
      setEditing(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  const handleProcess = async (id) => {
    try {
      const res = await processShareSplit(id);
      message.success(`Split processed: ${res.data.investments_updated} investments, ${res.data.subscriptions_updated} subscriptions updated (x${res.data.split_multiplier})`);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Processing failed');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 50 },
    { title: 'Split Date', dataIndex: 'split_date', render: d => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
    { title: 'Ratio', dataIndex: 'split_ratio', render: v => <Tag color="blue">{v}</Tag> },
    { title: 'Old Par Value', dataIndex: 'old_par_value', render: v => v?.toLocaleString() },
    { title: 'New Par Value', dataIndex: 'new_par_value', render: v => v?.toLocaleString() },
    {
      title: 'Status', dataIndex: 'status',
      render: s => <Tag color={s === 'processed' ? 'green' : 'orange'}>{s}</Tag>,
    },
    { title: 'Processed At', dataIndex: 'processed_at', render: d => d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '-' },
    {
      title: 'Actions', key: 'actions', width: 200,
      render: (_, r) => (
        <Space>
          {r.status !== 'processed' && (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => {
                setEditing(r);
                form.setFieldsValue({
                  ...r,
                  split_date: r.split_date ? dayjs(r.split_date) : null,
                });
                setModalOpen(true);
              }}>Edit</Button>
              <Popconfirm
                title="Process this share split? This will update ALL investments, subscriptions, and bank capital. This cannot be undone."
                onConfirm={() => handleProcess(r.id)}
                okText="Yes, Process"
                okButtonProps={{ danger: true }}
              >
                <Button size="small" type="primary" danger icon={<ThunderboltOutlined />}>Process</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Share Splits</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          setEditing(null);
          form.resetFields();
          setModalOpen(true);
        }}>
          New Share Split
        </Button>
      </Row>

      <Alert
        message="Share Split Information"
        type="info" showIcon
        style={{ marginBottom: 16 }}
        description={
          <Text style={{ fontSize: 12 }}>
            A share split divides existing shares into multiple new shares. For example, a <Text strong>2:1</Text> split
            doubles the number of shares and halves the par value. Processing a split will update all active investments,
            subscriptions, and bank capital settings. <Text type="danger">This action cannot be reversed.</Text>
          </Text>
        }
      />

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} />

      <Modal title={editing ? 'Edit Share Split' : 'New Share Split'} open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }} footer={null} width={500}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="split_date" label="Split Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="split_ratio" label="Split Ratio" rules={[{ required: true }]}
            tooltip="Format: N:M (e.g., 2:1 means each share becomes 2 shares)">
            <Input placeholder="e.g. 2:1" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="old_par_value" label="Old Par Value" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="new_par_value" label="New Par Value" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => { setModalOpen(false); setEditing(null); }}>Cancel</Button>
              <Button type="primary" htmlType="submit">{editing ? 'Update' : 'Create'}</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
