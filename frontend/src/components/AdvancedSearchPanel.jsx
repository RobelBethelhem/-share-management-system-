import { useState } from 'react';
import {
  Card, Row, Col, Select, Input, InputNumber, DatePicker, Button, Space, Typography,
} from 'antd';
import {
  PlusOutlined, MinusCircleOutlined, SearchOutlined, CloseOutlined, FilterOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

const { Paragraph } = Typography;

// OPS_BY_TYPE — the operator dropdown options keyed by the field's semantic type.
// Mirrors the backend's ApplyAdvancedFilters switch so what the user picks is
// guaranteed to be understood server-side.
export const OPS_BY_TYPE = {
  string: [
    { value: 'contains',    label: 'Contains (fuzzy)' },
    { value: 'starts_with', label: 'Starts with' },
    { value: 'ends_with',   label: 'Ends with' },
    { value: 'equals',      label: 'Equals exactly' },
    { value: 'not_equals',  label: 'Not equals' },
  ],
  int:    [{ value: 'equals', label: 'Equals' }, { value: 'gt', label: 'Greater than' }, { value: 'lt', label: 'Less than' }],
  number: [{ value: 'equals', label: 'Equals' }, { value: 'gt', label: 'Greater than' }, { value: 'lt', label: 'Less than' }, { value: 'between', label: 'Between' }],
  enum:   [{ value: 'equals', label: 'Is' }, { value: 'not_equals', label: 'Is not' }],
  bool:   [{ value: 'equals', label: 'Is' }],
  date:   [
    { value: 'between', label: 'Between' },
    { value: 'after',   label: 'On or after' },
    { value: 'before',  label: 'On or before' },
    { value: 'equals',  label: 'Exact date' },
  ],
};

const emptyRow = () => ({ field: '', op: '', value: '', value2: '' });

// AdvancedSearchPanel is a fully self-contained filter builder.
// Props:
//   fields  — array of { key, label, type, options? }
//             type is one of: 'string' | 'int' | 'number' | 'enum' | 'bool' | 'date'
//             options is required for enums (Ant Design Select options shape).
//   active  — whether a search is currently applied (controls the Reset chip etc.)
//   onSearch(filters) — called when admin clicks Search. Filters are pre-cleaned:
//                       any rows without (field, op) are dropped.
//   onReset()         — called when admin clicks Reset.
//   open    — whether the panel is expanded (parent controls open state).
export default function AdvancedSearchPanel({ fields, onSearch, onReset, open }) {
  const [rows, setRows] = useState([emptyRow()]);

  const updateRow = (idx, patch) =>
    setRows(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  const onFieldChange = (idx, fieldKey) => {
    const fd = fields.find(x => x.key === fieldKey);
    const defaultOp = fd ? OPS_BY_TYPE[fd.type][0].value : '';
    updateRow(idx, { field: fieldKey, op: defaultOp, value: '', value2: '' });
  };
  const addRow = () => setRows(rs => [...rs, emptyRow()]);
  const removeRow = (idx) => setRows(rs => rs.length > 1 ? rs.filter((_, i) => i !== idx) : [emptyRow()]);

  const handleSearch = () => {
    const cleaned = rows
      .filter(r => r.field && r.op)
      .map(r => ({ field: r.field, op: r.op, value: r.value, value2: r.value2 }));
    onSearch(cleaned);
  };

  const handleReset = () => {
    setRows([emptyRow()]);
    onReset();
  };

  if (!open) return null;

  return (
    <Card
      size="small"
      title={<Space><FilterOutlined /> Advanced Search</Space>}
      style={{ marginBottom: 16, background: '#fafafa' }}
      extra={
        <Space>
          <Button onClick={handleReset} icon={<CloseOutlined />}>Reset</Button>
          <Button type="primary" onClick={handleSearch} icon={<SearchOutlined />}>Search</Button>
        </Space>
      }
    >
      {rows.map((row, idx) => {
        const fd = fields.find(x => x.key === row.field);
        const ops = fd ? OPS_BY_TYPE[fd.type] : [];
        return (
          <Row gutter={8} key={idx} style={{ marginBottom: 8 }} align="middle">
            <Col span={6}>
              <Select
                placeholder="Choose field"
                value={row.field || undefined}
                style={{ width: '100%' }}
                showSearch
                optionFilterProp="label"
                onChange={(v) => onFieldChange(idx, v)}
                options={fields.map(f => ({ value: f.key, label: f.label }))}
              />
            </Col>
            <Col span={5}>
              <Select
                placeholder="Operator"
                value={row.op || undefined}
                style={{ width: '100%' }}
                disabled={!fd}
                onChange={(v) => updateRow(idx, { op: v, value: '', value2: '' })}
                options={ops}
              />
            </Col>
            <Col span={11}>
              <ValueInput fd={fd} row={row} onPatch={(p) => updateRow(idx, p)} />
            </Col>
            <Col span={2} style={{ textAlign: 'right' }}>
              <Button
                danger
                type="text"
                icon={<MinusCircleOutlined />}
                onClick={() => removeRow(idx)}
                title="Remove this filter"
              />
            </Col>
          </Row>
        );
      })}
      <Button onClick={addRow} icon={<PlusOutlined />} size="small">Add another filter</Button>
      <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
        All filters are AND-combined. &ldquo;Contains&rdquo; is a fuzzy match. &ldquo;Between&rdquo; on dates is inclusive on both ends.
      </Paragraph>
    </Card>
  );
}

function ValueInput({ fd, row, onPatch }) {
  if (!fd) return <Input placeholder="(pick a field first)" disabled />;
  const t = fd.type;
  if (t === 'string') {
    return (
      <Input
        placeholder="Value..."
        value={row.value}
        onChange={(e) => onPatch({ value: e.target.value })}
      />
    );
  }
  if (t === 'int') {
    return (
      <InputNumber
        style={{ width: '100%' }}
        value={row.value === '' ? undefined : row.value}
        onChange={(v) => onPatch({ value: v ?? '' })}
      />
    );
  }
  if (t === 'number') {
    if (row.op === 'between') {
      return (
        <Space.Compact style={{ width: '100%' }}>
          <InputNumber
            style={{ width: '50%' }}
            placeholder="From"
            value={row.value === '' ? undefined : row.value}
            onChange={(v) => onPatch({ value: v ?? '' })}
          />
          <InputNumber
            style={{ width: '50%' }}
            placeholder="To"
            value={row.value2 === '' ? undefined : row.value2}
            onChange={(v) => onPatch({ value2: v ?? '' })}
          />
        </Space.Compact>
      );
    }
    return (
      <InputNumber
        style={{ width: '100%' }}
        value={row.value === '' ? undefined : row.value}
        onChange={(v) => onPatch({ value: v ?? '' })}
      />
    );
  }
  if (t === 'enum') {
    return (
      <Select
        style={{ width: '100%' }}
        placeholder="Pick a value"
        allowClear
        value={row.value || undefined}
        onChange={(v) => onPatch({ value: v ?? '' })}
        options={fd.options || []}
      />
    );
  }
  if (t === 'bool') {
    return (
      <Select
        style={{ width: '100%' }}
        placeholder="Yes / No"
        value={row.value === '' ? undefined : row.value}
        onChange={(v) => onPatch({ value: v })}
        options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]}
      />
    );
  }
  if (t === 'date') {
    if (row.op === 'between') {
      return (
        <DatePicker.RangePicker
          style={{ width: '100%' }}
          value={[row.value ? dayjs(row.value) : null, row.value2 ? dayjs(row.value2) : null]}
          onChange={(dates) => onPatch({
            value: dates?.[0] ? dates[0].format('YYYY-MM-DD') : '',
            value2: dates?.[1] ? dates[1].format('YYYY-MM-DD') : '',
          })}
        />
      );
    }
    return (
      <DatePicker
        style={{ width: '100%' }}
        value={row.value ? dayjs(row.value) : null}
        onChange={(d) => onPatch({ value: d ? d.format('YYYY-MM-DD') : '' })}
      />
    );
  }
  return <Input disabled />;
}
