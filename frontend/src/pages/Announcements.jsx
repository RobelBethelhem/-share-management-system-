import { useState, useEffect } from 'react';
import {
  Card, Button, Modal, Form, Input, Radio, Upload, Space, Tag, message,
  Typography, Row, Col, Popconfirm, Switch, Empty, Spin, Statistic,
} from 'antd';
import {
  PlusOutlined, UploadOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, HeartOutlined, MessageOutlined, VideoCameraOutlined,
  PictureOutlined, InboxOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement } from '../services/api';
import { API_ORIGIN } from '../utils/apiBase';

dayjs.extend(relativeTime);

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

export default function Announcements() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [fileList, setFileList] = useState([]);
  const [annoType, setAnnoType] = useState('video');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getAnnouncements({ page, page_size: 12 });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('Failed to load announcements'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      if (fileList.length === 0) {
        message.error('Please upload at least one media file');
        return;
      }

      setCreating(true);
      const formData = new FormData();
      formData.append('title', values.title);
      formData.append('description', values.description || '');
      formData.append('type', values.type);
      fileList.forEach(f => {
        formData.append('media', f.originFileObj || f);
      });

      await createAnnouncement(formData);
      message.success('Announcement created!');
      setCreateOpen(false);
      form.resetFields();
      setFileList([]);
      setAnnoType('video');
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create');
    }
    setCreating(false);
  };

  const handleEdit = async () => {
    try {
      const values = await editForm.validateFields();
      await updateAnnouncement(editRecord.id, values);
      message.success('Updated!');
      setEditOpen(false);
      fetchData();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to update');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteAnnouncement(id);
      message.success('Deleted');
      fetchData();
    } catch { message.error('Failed to delete'); }
  };

  const openEdit = (record) => {
    setEditRecord(record);
    editForm.setFieldsValue({
      title: record.title,
      description: record.description,
      is_active: record.is_active,
    });
    setEditOpen(true);
  };

  const getMediaUrls = (item) => {
    try { return JSON.parse(item.media_urls || '[]'); }
    catch { return []; }
  };

  const formatCount = (n) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n || 0);
  };

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>Announcements</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setFileList([]); setAnnoType('video'); setCreateOpen(true); }}>
          New Announcement
        </Button>
      </Row>

      <Spin spinning={loading}>
        {data.length === 0 && !loading ? (
          <Empty description="No announcements yet" />
        ) : (
          <Row gutter={[16, 16]}>
            {data.map(item => {
              const urls = getMediaUrls(item);
              const thumbUrl = item.thumbnail_url ? `${API_ORIGIN}${item.thumbnail_url}` : null;
              return (
                <Col key={item.id} xs={24} sm={12} md={8} lg={6}>
                  <Card
                    hoverable
                    cover={
                      <div style={{ height: 200, overflow: 'hidden', background: '#000', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {thumbUrl ? (
                          item.type === 'video' ? (
                            <video src={thumbUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                          ) : (
                            <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          )
                        ) : (
                          <div style={{ color: '#666', fontSize: 40 }}>
                            {item.type === 'video' ? <VideoCameraOutlined /> : <PictureOutlined />}
                          </div>
                        )}
                        <Tag color={item.type === 'video' ? 'blue' : 'green'}
                          style={{ position: 'absolute', top: 8, left: 8 }}>
                          {item.type === 'video' ? 'Video' : 'Carousel'} {urls.length > 1 ? `(${urls.length})` : ''}
                        </Tag>
                        {!item.is_active && (
                          <Tag color="red" style={{ position: 'absolute', top: 8, right: 8 }}>Inactive</Tag>
                        )}
                      </div>
                    }
                    actions={[
                      <span key="edit" onClick={() => openEdit(item)}><EditOutlined /> Edit</span>,
                      <Popconfirm key="del" title="Delete this announcement?" onConfirm={() => handleDelete(item.id)}>
                        <span><DeleteOutlined /> Delete</span>
                      </Popconfirm>,
                    ]}
                  >
                    <Card.Meta
                      title={<Text ellipsis={{ tooltip: item.title }}>{item.title}</Text>}
                      description={
                        <div>
                          <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 8, fontSize: 12 }}>
                            {item.description || 'No description'}
                          </Paragraph>
                          <Space size="middle">
                            <span><EyeOutlined /> {formatCount(item.view_count)}</span>
                            <span><HeartOutlined /> {formatCount(item.like_count)}</span>
                            <span><MessageOutlined /> {formatCount(item.comment_count)}</span>
                          </Space>
                          <div style={{ marginTop: 6, fontSize: 11, color: '#999' }}>
                            {dayjs(item.created_at).fromNow()}
                          </div>
                        </div>
                      }
                    />
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Spin>

      {total > 12 && (
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <span style={{ margin: '0 16px' }}>Page {page}</span>
          <Button onClick={() => setPage(p => p + 1)} disabled={page * 12 >= total}>Next</Button>
        </div>
      )}

      {/* Create Modal */}
      <Modal
        title="New Announcement"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="Publish"
        width={600}
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'video' }}>
          <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Title is required' }]}>
            <Input placeholder="Announcement title..." />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={3} placeholder="Describe your announcement..." />
          </Form.Item>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Radio.Group onChange={e => { setAnnoType(e.target.value); setFileList([]); }}>
              <Radio.Button value="video"><VideoCameraOutlined /> Video</Radio.Button>
              <Radio.Button value="carousel"><PictureOutlined /> Image Carousel</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="Media" required>
            <Upload.Dragger
              fileList={fileList}
              onChange={({ fileList: fl }) => setFileList(fl)}
              beforeUpload={() => false}
              accept={annoType === 'video' ? 'video/*' : 'image/*'}
              multiple={annoType === 'carousel'}
              maxCount={annoType === 'video' ? 1 : 10}
              listType={annoType === 'carousel' ? 'picture-card' : 'text'}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">
                {annoType === 'video' ? 'Click or drag video file' : 'Click or drag images (up to 10)'}
              </p>
              <p className="ant-upload-hint">
                {annoType === 'video' ? 'MP4, MOV, WebM supported' : 'JPG, PNG, WebP supported'}
              </p>
            </Upload.Dragger>
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title="Edit Announcement"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleEdit}
        okText="Save"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="is_active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
