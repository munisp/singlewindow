import 'package:flutter_test/flutter_test.dart';
import '../lib/utils/date_utils.dart';

void main() {
  group('DateUtils', () {
    test('formatDate returns DD/MM/YYYY', () {
      final date = DateTime(2025, 3, 15);
      expect(formatDate(date), '15/03/2025');
    });

    test('timeAgo returns hours ago', () {
      final twoHoursAgo = DateTime.now().subtract(const Duration(hours: 2));
      expect(timeAgo(twoHoursAgo), '2h ago');
    });
  });
}
