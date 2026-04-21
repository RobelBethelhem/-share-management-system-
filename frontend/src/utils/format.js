export const formatCurrency = (amount) => {
  if (amount == null) return 'ETB 0.00';
  return `ETB ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatNumber = (num) => {
  if (num == null) return '0';
  return Number(num).toLocaleString('en-US');
};

export const shareholderTypes = [
  { value: 'Individual', label: 'Individual' },
  { value: 'Joint', label: 'Joint' },
  { value: 'Corporate', label: 'Corporate' },
  { value: 'Association', label: 'Association' },
  { value: 'Economic', label: 'Economic' },
];

export const paymentMethods = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'check', label: 'Check' },
  { value: 'cpo', label: 'CPO' },
  { value: 'dividend', label: 'Dividend' },
];

export const transferTypes = [
  { value: 'sale', label: 'Sale' },
  { value: 'gift', label: 'Gift' },
  { value: 'inheritance', label: 'Inheritance' },
  { value: 'legal_order', label: 'Legal Order' },
];

export const blockTypes = [
  { value: 'court_order', label: 'Court Order' },
  { value: 'collateral', label: 'Collateral' },
  { value: 'pledge', label: 'Pledge' },
  { value: 'other', label: 'Other' },
];
