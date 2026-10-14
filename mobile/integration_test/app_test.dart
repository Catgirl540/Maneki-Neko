import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:luckycat/core/api.dart';
import 'package:luckycat/main.dart' as app;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('真实安卓：登录 → 账户 → 转账弹窗 → 理财 → 助手 → 我的', (tester) async {
    final endpoints = Endpoints();
    expect(
      [
        '10.0.2.2',
        '127.0.0.1',
        'localhost',
      ].contains(Uri.parse(endpoints.bank).host),
      isTrue,
      reason: '仅运行隔离联调环境',
    );
    final api = Api(endpoints.bank, token: () => '', onExpired: () {});
    final sms = object(
      await api.call(
        'api/auth/sms-code',
        method: 'POST',
        body: {'phone': '13800138000'},
      ),
    );
    app.main();
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextFormField, '手机号'),
      '13800138000',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, '登录密码'),
      '123456',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, '短信验证码'),
      '${sms['demoCode']}',
    );
    await tester.ensureVisible(find.text('登录'));
    await tester.tap(find.text('登录'));
    for (var i = 0; i < 60 && find.text('账户管理').evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(find.text('账户管理'), findsOneWidget);
    expect(tester.takeException(), null);
    await binding.convertFlutterSurfaceToImage();
    await tester.pumpAndSettle();
    await binding.takeScreenshot('flutter-account');
    await tester.ensureVisible(find.text('转账'));
    await tester.tap(find.text('转账'));
    await tester.pumpAndSettle();
    expect(find.text('转入'), findsOneWidget);
    expect(find.text('转出'), findsOneWidget);
    await binding.takeScreenshot('flutter-transfer');
    await tester.tapAt(const Offset(10, 50));
    await tester.pumpAndSettle();
    await tester.tap(find.text('理财'));
    await tester.pumpAndSettle();
    expect(find.text('理财产品'), findsOneWidget);
    await binding.takeScreenshot('flutter-wealth');
    await tester.tap(find.text('助手'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('语音输入'), findsOneWidget);
    expect(find.byTooltip('添加图片'), findsOneWidget);
    await binding.takeScreenshot('flutter-assistant');
    await tester.tap(find.text('我的'));
    await tester.pumpAndSettle();
    expect(find.text('账户与安全'), findsOneWidget);
    await binding.takeScreenshot('flutter-profile');
    expect(tester.takeException(), null);
    api.close();
  });
}
