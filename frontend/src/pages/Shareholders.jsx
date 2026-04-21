import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, DatePicker, Space, Tag,
  message, Typography, Row, Col, Card, Tabs, Switch, Descriptions, Popconfirm,
} from 'antd';
import { PlusOutlined, SearchOutlined, EditOutlined, EyeOutlined, DeleteOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getShareholders, createShareholder, updateShareholder, deleteShareholder } from '../services/api';
import { shareholderTypes } from '../utils/format';

const { Title } = Typography;

export default function Shareholders() {
  const [shareholders, setShareholders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data } = await getShareholders({ page, page_size: 20, search, type: typeFilter });
      setShareholders(data.data || []);
      setTotal(data.total || 0);
    } catch {
      message.error('Failed to load shareholders');
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page, search, typeFilter]);

  const handleSubmit = async (values) => {
    try {
      if (values.date_of_birth) values.date_of_birth = values.date_of_birth.toISOString();
      const payload = {
        ...values,
        address: {
          region: values.region, city: values.city, sub_city: values.sub_city,
          woreda: values.woreda, kebele: values.kebele, house_no: values.house_no,
          po_box: values.po_box,
          region_am: values.region_am, city_am: values.city_am, sub_city_am: values.sub_city_am,
          woreda_am: values.woreda_am, kebele_am: values.kebele_am,
        },
      };

      if (editing) {
        await updateShareholder(editing.id, payload);
        message.success('Shareholder updated');
      } else {
        await createShareholder(payload);
        message.success('Shareholder created');
      }
      setModalOpen(false);
      form.resetFields();
      setEditing(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Operation failed');
    }
  };

  const handleEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      date_of_birth: record.date_of_birth ? dayjs(record.date_of_birth) : null,
      region: record.address?.region,
      city: record.address?.city,
      sub_city: record.address?.sub_city,
      woreda: record.address?.woreda,
      kebele: record.address?.kebele,
      house_no: record.address?.house_no,
      po_box: record.address?.po_box,
      region_am: record.address?.region_am,
      city_am: record.address?.city_am,
      sub_city_am: record.address?.sub_city_am,
      woreda_am: record.address?.woreda_am,
      kebele_am: record.address?.kebele_am,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id) => {
    await deleteShareholder(id);
    message.success('Deleted');
    fetchData();
  };

  const columns = [
    { title: 'Account No', dataIndex: 'account_no', key: 'account_no', width: 120 },
    {
      title: 'Name', key: 'name', render: (_, r) =>
        `${r.first_name} ${r.middle_name || ''} ${r.last_name}`.trim(),
    },
    { title: 'Type', dataIndex: 'shareholder_type', key: 'type', width: 100,
      render: (t) => <Tag color="blue">{t}</Tag>,
    },
    { title: 'Phone', dataIndex: 'phone', key: 'phone', width: 130 },
    { title: 'TIN', dataIndex: 'tin', key: 'tin', width: 120 },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 90,
      render: (s) => <Tag color={s === 'active' ? 'green' : 'red'}>{s}</Tag>,
    },
    {
      title: 'Actions', key: 'actions', width: 150,
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/shareholders/${record.id}`)} />
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Popconfirm title="Delete?" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Shareholders</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true); }}>
          New Shareholder
        </Button>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Input.Search
            placeholder="Search name, account, TIN..."
            onSearch={(v) => { setSearch(v); setPage(1); }}
            allowClear
          />
        </Col>
        <Col span={4}>
          <Select
            placeholder="Filter by type"
            allowClear
            style={{ width: '100%' }}
            options={shareholderTypes}
            onChange={(v) => { setTypeFilter(v || ''); setPage(1); }}
          />
        </Col>
      </Row>

      <Table
        dataSource={shareholders}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage, showTotal: (t) => `Total ${t}` }}
        scroll={{ x: 900 }}
        size="small"
      />

      <Modal
        title={editing ? 'Edit Shareholder' : 'New Shareholder'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        footer={null}
        width={900}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Tabs items={[
            {
              key: 'personal', label: 'Personal Info',
              children: (
                <>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="account_no" label="Account No" rules={[{ required: true }]}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="shareholder_type" label="Type" rules={[{ required: true }]}>
                        <Select options={shareholderTypes} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="nationality" label="Nationality (English)">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={8} offset={16}>
                      <Form.Item name="nationality_am" label="Nationality (አማርኛ)">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="first_name" label="First Name (English)" rules={[{ required: true }]}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="middle_name" label="Middle Name (English)">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="last_name" label="Last Name (English)" rules={[{ required: true }]}>
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="first_name_am" label="First Name (አማርኛ)">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="middle_name_am" label="Middle Name (አማርኛ)">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="last_name_am" label="Last Name (አማርኛ)">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={6}>
                      <Form.Item name="gender" label="Gender">
                        <Select options={[{ value: 'Male' }, { value: 'Female' }]} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="date_of_birth" label="Date of Birth">
                        <DatePicker style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="phone" label="Phone 1">
                        <Input placeholder="Primary phone" />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="phone2" label="Phone 2">
                        <Input placeholder="Optional" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={6}>
                      <Form.Item name="phone3" label="Phone 3">
                        <Input placeholder="Optional" />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="email" label="Email 1">
                        <Input placeholder="Primary email" />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="email2" label="Email 2">
                        <Input placeholder="Optional" />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="email3" label="Email 3">
                        <Input placeholder="Optional" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="tin" label="TIN">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="passport_no" label="Passport No">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="national_id_no" label="National ID No">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={6}>
                      <Form.Item name="is_staff" label="Staff" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="is_foreign" label="Foreign" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="citizenship_status" label="Citizenship Status">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ),
            },
            {
              key: 'address', label: 'Address',
              children: (
                <>
                  <Row gutter={16}>
                    <Col span={8}><Form.Item name="region" label="Region (English)"><Input /></Form.Item></Col>
                    <Col span={8}><Form.Item name="city" label="City (English)"><Input /></Form.Item></Col>
                    <Col span={8}><Form.Item name="sub_city" label="Sub City (English)"><Input /></Form.Item></Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={8}><Form.Item name="region_am" label="Region (አማርኛ)"><Input /></Form.Item></Col>
                    <Col span={8}><Form.Item name="city_am" label="City (አማርኛ)"><Input /></Form.Item></Col>
                    <Col span={8}><Form.Item name="sub_city_am" label="Sub City (አማርኛ)"><Input /></Form.Item></Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={8}><Form.Item name="woreda" label="Woreda (English)"><Input /></Form.Item></Col>
                    <Col span={8}><Form.Item name="kebele" label="Kebele (English)"><Input /></Form.Item></Col>
                    <Col span={8}><Form.Item name="house_no" label="House No"><Input /></Form.Item></Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={8}><Form.Item name="woreda_am" label="Woreda (አማርኛ)"><Input /></Form.Item></Col>
                    <Col span={8}><Form.Item name="kebele_am" label="Kebele (አማርኛ)"><Input /></Form.Item></Col>
                    <Col span={8}><Form.Item name="po_box" label="P.O.Box"><Input /></Form.Item></Col>
                  </Row>
                </>
              ),
            },
          ]} />
          <Form.Item style={{ textAlign: 'right', marginTop: 16 }}>
            <Space>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">{editing ? 'Update' : 'Create'}</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
