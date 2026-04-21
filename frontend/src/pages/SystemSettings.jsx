import { useState, useEffect } from 'react';
import {
  Card, Form, Input, InputNumber, Button, Space, Table, Tag, message,
  Typography, Row, Col, Divider, Popconfirm, Modal, Descriptions, Statistic,
  Alert,
} from 'antd';
import {
  SaveOutlined, PlusOutlined, DeleteOutlined, ExperimentOutlined,
  BankOutlined, SettingOutlined, EditOutlined,
} from '@ant-design/icons';
import {
  getSystemSettings, createSystemSetting, updateSystemSetting, deleteSystemSetting,
  testFormula, getBankCapital, updateBankCapital,
} from '../services/api';
import { formatCurrency } from '../utils/format';

const { Title, Text } = Typography;

export default function SystemSettings() {
  const [bankCapital, setBankCapital] = useState(null);
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bcForm] = Form.useForm();
  const [addModal, setAddModal] = useState(false);
  const [addForm] = Form.useForm();
  const [editingSetting, setEditingSetting] = useState(null);
  const [editForm] = Form.useForm();
  const [testModal, setTestModal] = useState(null);
  const [testForm] = Form.useForm();
  const [testResult, setTestResult] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [bcRes, settingsRes] = await Promise.all([
        getBankCapital(),
        getSystemSettings(),
      ]);
      const bc = bcRes.data.data;
      setBankCapital(bc);
      if (bc) {
        bcForm.setFieldsValue({
          authorized_capital: bc.authorized_capital,
          par_value_per_share: bc.par_value_per_share,
          total_shares: bc.total_shares,
        });
      }
      setSettings(settingsRes.data.data || []);
    } catch {
      message.error('Failed to load settings');
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleBankCapitalSave = async (values) => {
    const { authorized_capital, par_value_per_share, total_shares } = values;

    // Validation: par_value × total_shares must not exceed authorized_capital
    const totalParValue = par_value_per_share * total_shares;
    if (totalParValue > authorized_capital) {
      message.error(
        `Par Value (${par_value_per_share.toLocaleString()}) × Total Shares (${total_shares.toLocaleString()}) = ${totalParValue.toLocaleString()} Birr exceeds Authorized Capital (${authorized_capital.toLocaleString()} Birr)`
      );
      return;
    }

    try {
      await updateBankCapital({
        authorized_capital,
        par_value_per_share,
        total_shares,
      });
      message.success('Company capital updated');
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to update');
    }
  };

  const handleSettingUpdate = async (values) => {
    try {
      await updateSystemSetting(editingSetting.key, {
        value: values.value,
        description: values.description,
      });
      message.success(`Setting "${editingSetting.key}" updated`);
      setEditingSetting(null);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to update');
    }
  };

  const handleSettingAdd = async (values) => {
    try {
      await createSystemSetting(values);
      message.success(`Setting "${values.key}" created`);
      setAddModal(false);
      addForm.resetFields();
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create');
    }
  };

  const handleSettingDelete = async (key) => {
    try {
      await deleteSystemSetting(key);
      message.success(`Setting "${key}" deleted`);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleTestFormula = async (values) => {
    try {
      // Parse vars from comma-separated "key=value" pairs
      const vars = {};
      if (values.vars) {
        values.vars.split(',').forEach(pair => {
          const [k, v] = pair.trim().split('=');
          if (k && v) vars[k.trim()] = parseFloat(v.trim());
        });
      }
      const res = await testFormula({ formula: testModal.value, vars });
      setTestResult(res.data);
    } catch (err) {
      setTestResult({ error: err.response?.data?.error || 'Formula error' });
    }
  };

  const isFormula = (key) => key.includes('formula');

  const settingColumns = [
    {
      title: 'Key', dataIndex: 'key', width: 200,
      render: (k) => <Text code>{k}</Text>,
    },
    {
      title: 'Value', dataIndex: 'value',
      render: (v, r) => isFormula(r.key)
        ? <Tag color="blue" style={{ fontFamily: 'monospace' }}>{v}</Tag>
        : <Text>{v}</Text>,
    },
    {
      title: 'Description', dataIndex: 'description',
      render: (d) => <Text type="secondary" style={{ fontSize: 12 }}>{d || '-'}</Text>,
    },
    {
      title: 'Actions', key: 'actions', width: 200,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => {
            setEditingSetting(r);
            editForm.setFieldsValue({ value: r.value, description: r.description });
          }}>Edit</Button>
          {isFormula(r.key) && (
            <Button size="small" icon={<ExperimentOutlined />} onClick={() => {
              setTestModal(r);
              setTestResult(null);
              testForm.resetFields();
            }}>Test</Button>
          )}
          <Popconfirm title={`Delete "${r.key}"?`} onConfirm={() => handleSettingDelete(r.key)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4}><SettingOutlined /> System Settings</Title>

      <Alert
        message="All settings on this page are dynamic and editable. Changes take effect immediately across the system."
        type="info" showIcon style={{ marginBottom: 24 }}
      />

      {/* ─── Section 1: Company Capital ─── */}
      <Card
        title={<><BankOutlined /> Company Capital Configuration</>}
        style={{ marginBottom: 24 }}
        extra={
          bankCapital && (
            <Space>
              <Text type="secondary">
                Capital Utilization: {bankCapital.authorized_capital > 0
                  ? ((bankCapital.paid_up_capital / bankCapital.authorized_capital) * 100).toFixed(1)
                  : 0}%
              </Text>
            </Space>
          )
        }
      >
        <Form form={bcForm} layout="vertical" onFinish={handleBankCapitalSave}>
          <Row gutter={24}>
            <Col span={6}>
              <Form.Item name="authorized_capital" label="Authorized Capital (Birr)"
                rules={[{ required: true }]}
                tooltip="Maximum total capital the company is allowed to raise">
                <InputNumber style={{ width: '100%' }} min={0}
                  formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={v => v.replace(/,/g, '')} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <div style={{ marginBottom: 24 }}>
                <div style={{ marginBottom: 4, fontWeight: 500 }}>
                  Paid-Up Capital (Birr)
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                    (Auto-calculated from approved investments)
                  </Text>
                </div>
                <Statistic
                  value={bankCapital?.paid_up_capital || 0}
                  precision={2}
                  suffix="Birr"
                  style={{ border: '1px solid #d9d9d9', borderRadius: 6, padding: '4px 11px', background: '#fafafa' }}
                />
              </div>
            </Col>
            <Col span={6}>
              <Form.Item name="par_value_per_share" label="Par Value per Share (Birr)"
                rules={[{ required: true }]}
                tooltip="Nominal/face value of one share">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="total_shares" label="Total Company Shares"
                rules={[{ required: true }]}
                tooltip="Total number of shares the company has issued">
                <InputNumber style={{ width: '100%' }} min={0}
                  formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={v => v.replace(/,/g, '')} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
              Save Company Capital
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* ─── Section 2: System Settings (Key-Value) ─── */}
      <Card
        title={<><SettingOutlined /> Formulas & Configuration</>}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {
            addForm.resetFields();
            setAddModal(true);
          }}>
            Add Setting
          </Button>
        }
      >
        <Table
          dataSource={settings}
          columns={settingColumns}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={false}
        />
      </Card>

      {/* ─── Add Setting Modal ─── */}
      <Modal title="Add New Setting" open={addModal}
        onCancel={() => setAddModal(false)} footer={null} width={500}>
        <Form form={addForm} layout="vertical" onFinish={handleSettingAdd}>
          <Form.Item name="key" label="Setting Key" rules={[{ required: true }]}
            tooltip="Use snake_case (e.g., transfer_fee_formula, min_shares)">
            <Input placeholder="e.g., transfer_fee_formula" />
          </Form.Item>
          <Form.Item name="value" label="Value" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="e.g., shares * par_value * 0.02" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Describe what this setting does and available variables" />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setAddModal(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">Create</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* ─── Edit Setting Modal ─── */}
      <Modal title={`Edit: ${editingSetting?.key}`} open={!!editingSetting}
        onCancel={() => setEditingSetting(null)} footer={null} width={500}>
        <Form form={editForm} layout="vertical" onFinish={handleSettingUpdate}>
          <Form.Item name="value" label="Value" rules={[{ required: true }]}>
            <Input.TextArea rows={3} style={isFormula(editingSetting?.key || '') ? { fontFamily: 'monospace' } : {}} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setEditingSetting(null)}>Cancel</Button>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>Save</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* ─── Test Formula Modal ─── */}
      <Modal title={`Test Formula: ${testModal?.key}`} open={!!testModal}
        onCancel={() => { setTestModal(null); setTestResult(null); }} footer={null} width={550}>
        {testModal && (
          <>
            <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Formula">
                <Text code>{testModal.value}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Description">
                {testModal.description || '-'}
              </Descriptions.Item>
            </Descriptions>
            <Form form={testForm} layout="vertical" onFinish={handleTestFormula}>
              <Form.Item name="vars" label="Test Variables (comma-separated key=value)"
                rules={[{ required: true }]}
                tooltip="e.g., shares=100, par_value=1000, days_held=180, days_in_year=365">
                <Input.TextArea rows={2}
                  placeholder="shares=100, par_value=1000, days_held=180, days_in_year=365" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 8 }}>
                <Button type="primary" htmlType="submit" icon={<ExperimentOutlined />}>
                  Run Test
                </Button>
              </Form.Item>
            </Form>
            {testResult && (
              <Card size="small" style={{
                backgroundColor: testResult.error ? '#fff2f0' : '#f6ffed',
                borderColor: testResult.error ? '#ffccc7' : '#b7eb8f',
              }}>
                {testResult.error ? (
                  <Text type="danger">{testResult.error}</Text>
                ) : (
                  <Statistic title="Result" value={testResult.result} precision={4} />
                )}
              </Card>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
