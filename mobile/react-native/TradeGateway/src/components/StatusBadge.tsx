import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type Status = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CLEARED';

const STATUS_COLORS: Record<Status, { bg: string; text: string }> = {
  SUBMITTED: { bg: '#EFF6FF', text: '#1D4ED8' },
  UNDER_REVIEW: { bg: '#FFFBEB', text: '#B45309' },
  APPROVED: { bg: '#ECFDF5', text: '#065F46' },
  REJECTED: { bg: '#FEF2F2', text: '#991B1B' },
  CLEARED: { bg: '#F0FDF4', text: '#166534' },
};

export function StatusBadge({ status }: { status: Status }) {
  const colors = STATUS_COLORS[status] ?? { bg: '#F3F4F6', text: '#374151' };
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.text, { color: colors.text }]}>{status.replace('_', ' ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  text: { fontSize: 12, fontWeight: '600' },
});
