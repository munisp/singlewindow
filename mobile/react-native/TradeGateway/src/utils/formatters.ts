export const formatCurrency = (amount: number, currency = 'USD'): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

export const formatDate = (ts: number): string =>
  new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export const formatStatus = (status: string): string =>
  status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
