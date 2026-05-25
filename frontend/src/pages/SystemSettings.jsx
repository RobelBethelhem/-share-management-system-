import { useState, useEffect } from 'react';
import {
  Card, Form, Input, InputNumber, Button, Space, Table, Tag, message,
  Typography, Row, Col, Divider, Popconfirm, Modal, Descriptions, Statistic,
  Alert, Checkbox,
} from 'antd';
import {
  SaveOutlined, PlusOutlined, DeleteOutlined, ExperimentOutlined,
  BankOutlined, SettingOutlined, EditOutlined, WarningOutlined,
} from '@ant-design/icons';
import {
  getSystemSettings, createSystemSetting, updateSystemSetting, deleteSystemSetting,
  testFormula, getBankCapital, updateBankCapital, resetAllData, getResetCategories,
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
  const [resetModal, setResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState(null);
  const [resetCategories, setResetCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);

  // Fetch available reset categories once on mount so the modal can render
  // checkboxes. Failure here is non-fatal — modal still works as a full reset.
  useEffect(() => {
    getResetCategories()
      .then(r => setResetCategories(r.data?.categories || []))
      .catch(() => {});
  }, []);

  const handleResetAllData = async () => {
    if (resetConfirmText.trim() !== 'RESET') {
      message.error('You must type RESET (uppercase) exactly to confirm.');
      return;
    }
    setResetLoading(true);
    try {
      const res = await resetAllData(resetConfirmText.trim(), selectedCategories);
      setResetResult(res.data);
      message.success(
        selectedCategories.length > 0
          ? `${selectedCategories.length} categor${selectedCategories.length === 1 ? 'y' : 'ies'} wiped.`
          : 'All business data wiped. Defaults re-seeded.'
      );
      await fetchData();
    } catch (e) {
      message.error(e.response?.data?.error || 'Reset failed');
    }
    setResetLoading(false);
  };

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

      {/* Danger Zone: wipe all business data while preserving login users */}
      <Card
        size="small"
        style={{ marginTop: 24, borderColor: '#ff4d4f' }}
        title={
          <Space>
            <WarningOutlined style={{ color: '#cf1322' }} />
            <Text strong style={{ color: '#cf1322' }}>Danger Zone</Text>
          </Space>
        }
      >
        <Alert
          type="error"
          showIcon
          message="Reset all data"
          description={
            <div>
              <div><b>Wiped:</b> shareholders, investments, subscriptions, allocations, transfers, dividends, blocks, certificates, capital increases, AGM data, dividend settings, audit logs, &hellip; (auto-increment IDs reset to 1).</div>
              <div style={{ marginTop: 8 }}>
                <b>Preserved (Formulas &amp; Configuration):</b>
                <div style={{ marginTop: 4 }}>
                  <Tag color="green">users</Tag>
                  <Tag color="green">system_settings</Tag>
                  <Tag color="green">bank_capital</Tag>
                  <Tag color="green">dividend_tax_schedules</Tag>
                  <Tag color="green">mini_app_categories</Tag>
                  <Tag color="green">mini_apps</Tag>
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                  Your customized formulas (tax, share calc, transfer fee), fee rates, par value, authorized capital, and tax brackets all survive the reset.
                </div>
              </div>
              <div style={{ marginTop: 8, color: '#cf1322' }}>
                <b>This cannot be undone.</b> Take a database backup first if there is any chance you'll want the wiped data back.
              </div>
            </div>
          }
        />
        <Button
          danger
          type="primary"
          icon={<DeleteOutlined />}
          style={{ marginTop: 12 }}
          onClick={() => {
            setResetConfirmText('');
            setResetResult(null);
            setSelectedCategories([]);
            setResetModal(true);
          }}
        >
          Reset Data&hellip;
        </Button>
      </Card>

      <Modal
        open={resetModal}
        title={
          <Space>
            <WarningOutlined style={{ color: '#cf1322' }} />
            <Text strong style={{ color: '#cf1322' }}>
              {selectedCategories.length > 0
                ? `Confirm: Wipe ${selectedCategories.length} categor${selectedCategories.length === 1 ? 'y' : 'ies'}`
                : 'Confirm: Reset ALL Data'}
            </Text>
          </Space>
        }
        onCancel={() => setResetModal(false)}
        footer={resetResult ? (
          <Button type="primary" onClick={() => setResetModal(false)}>Close</Button>
        ) : (
          <Space>
            <Button onClick={() => setResetModal(false)}>Cancel</Button>
            <Button
              danger type="primary" loading={resetLoading}
              disabled={resetConfirmText.trim() !== 'RESET'}
              onClick={handleResetAllData}
            >
              {selectedCategories.length > 0 ? 'Wipe Selected' : 'Wipe All Data'}
            </Button>
          </Space>
        )}
        maskClosable={!resetLoading}
        closable={!resetLoading}
        width={720}
      >
        {!resetResult ? (
          <>
            <Alert
              type="warning"
              showIcon
              message={selectedCategories.length > 0 ? 'Selective wipe — irreversible' : 'Full reset — irreversible'}
              description={
                selectedCategories.length > 0
                  ? `Only the selected categories will be wiped. Each category cascades to any other tables that reference it (so no orphan rows remain). All other business data and Formulas & Configuration stay intact.`
                  : 'No categories selected → this will wipe EVERY business table. Only login accounts and Formulas & Configuration (system_settings, bank_capital, tax brackets, mini-apps) are preserved.'
              }
              style={{ marginBottom: 12 }}
            />

            <div style={{
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              padding: 12,
              marginBottom: 12,
              maxHeight: 280,
              overflowY: 'auto',
              background: '#fafafa',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text strong style={{ fontSize: 13 }}>
                  Categories to wipe&nbsp;
                  <Text type="secondary" style={{ fontWeight: 400, fontSize: 11 }}>
                    (leave all unchecked for a full reset)
                  </Text>
                </Text>
                <Space size={4}>
                  <Button size="small" type="link" onClick={() => setSelectedCategories([])}>
                    Clear
                  </Button>
                  <Button size="small" type="link" danger
                    onClick={() => setSelectedCategories(resetCategories.map(c => c.key))}>
                    Select all
                  </Button>
                </Space>
              </div>
              <Checkbox.Group
                value={selectedCategories}
                onChange={setSelectedCategories}
                style={{ width: '100%' }}
              >
                <Row gutter={[8, 4]}>
                  {resetCategories.map(cat => (
                    <Col span={24} key={cat.key}>
                      <Checkbox value={cat.key}>
                        <Text strong style={{ fontSize: 12 }}>{cat.label}</Text>
                        <div style={{ fontSize: 11, color: '#666', marginLeft: 24, marginTop: 1, lineHeight: 1.3 }}>
                          {cat.description}
                        </div>
                      </Checkbox>
                    </Col>
                  ))}
                </Row>
              </Checkbox.Group>
            </div>

            <Text>Type <Text code strong>RESET</Text> (uppercase) below to enable the Wipe button:</Text>
            <Input
              placeholder="Type RESET"
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              style={{ marginTop: 8 }}
              autoFocus
            />
          </>
        ) : (
          <>
            <Alert
              type="success"
              showIcon
              message={resetResult.message || 'Reset complete'}
              style={{ marginBottom: 12 }}
            />
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Mode">
                <Tag color={resetResult.mode === 'full' ? 'red' : 'orange'}>
                  {resetResult.mode === 'full' ? 'FULL RESET' : 'SELECTIVE'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Tables cleared">
                <Text strong>{resetResult.cleared_tables?.length || 0}</Text>
              </Descriptions.Item>
              {resetResult.categories_wiped && (
                <Descriptions.Item label="Categories wiped">
                  {resetResult.categories_wiped.map(k => <Tag key={k} color="orange">{k}</Tag>)}
                </Descriptions.Item>
              )}
              {resetResult.preserved && (
                <Descriptions.Item label="Tables preserved">
                  {resetResult.preserved.map(t => <Tag key={t} color="green">{t}</Tag>)}
                </Descriptions.Item>
              )}
              {Object.keys(resetResult.failed_tables || {}).length > 0 && (
                <Descriptions.Item label="Failures">
                  {Object.entries(resetResult.failed_tables).map(([t, err]) => (
                    <div key={t}><Tag color="red">{t}</Tag> <Text type="danger" style={{ fontSize: 11 }}>{err}</Text></div>
                  ))}
                </Descriptions.Item>
              )}
            </Descriptions>
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              message="Refresh the page (or re-login) to see the result. Defaults are re-seeded only on a full reset."
            />
          </>
        )}
      </Modal>
    </div>
  );
}
