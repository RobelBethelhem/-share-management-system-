import { Form, Input, Button, Card, message, Typography } from 'antd';
import { UserOutlined, LockOutlined, FundOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { login } from '../services/api';

const { Title, Text } = Typography;

export default function Login() {
  const navigate = useNavigate();
  const { loginUser } = useAuth();

  const onFinish = async (values) => {
    try {
      const { data } = await login(values);
      loginUser(data.user, data.token);
      message.success('Login successful');
      navigate('/');
    } catch (err) {
      message.error(err.response?.data?.error || 'Login failed');
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #e53935 0%, #880e4f 100%)',
    }}>
      <Card style={{ width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <FundOutlined style={{ fontSize: 48, color: '#d32f2f', marginBottom: 16 }} />
          <Title level={3} style={{ margin: 0 }}>Share Administration System</Title>
          <Text type="secondary">Sign in to your account</Text>
        </div>
        <Form onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: 'Enter username' }]}>
            <Input prefix={<UserOutlined />} placeholder="Username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: 'Enter password' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block>Sign In</Button>
          </Form.Item>
        </Form>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: 12 }}>
          Default: admin / admin123
        </Text>
      </Card>
    </div>
  );
}
