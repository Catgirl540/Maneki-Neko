import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:luckycat/core/api.dart';
import 'package:luckycat/core/session.dart';
import 'package:luckycat/main.dart';
import 'package:luckycat/pages/account.dart';
import 'package:luckycat/pages/shell.dart';
import 'package:luckycat/ui/common.dart';

void main() {
  testWidgets('登录页在窄屏、放大文字与键盘下可以滚动', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    tester.view.viewInsets = const FakeViewPadding(bottom: 260);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    addTearDown(tester.view.resetViewInsets);
    await tester.pumpWidget(const LuckycatApp());
    expect(find.text('欢迎回来'), findsOneWidget);
    expect(find.text('登录'), findsOneWidget);
    await tester.ensureVisible(find.text('还没有账户？注册开户'));
    await tester.tap(find.text('还没有账户？注册开户'));
    await tester.pumpAndSettle();
    expect(find.text('注册并开通储蓄账户'), findsOneWidget);
    expect(tester.takeException(), null);
  });
  testWidgets('设计稿账户布局、真实数据渲染及转账弹窗可达', (tester) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final session = BankSession(
      Endpoints(bank: 'https://bank.example'),
      bankClient: MockClient(
        (request) async => http.Response(
          jsonEncode(
            request.url.path == '/api/banks'
                ? [
                    {'code': 'LCB', 'name': '招财猫银行', 'region': 'CN'},
                  ]
                : [],
          ),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        ),
      ),
    );
    session.user = {'id': 'test', 'name': '林然'};
    session.token = 't';
    session.accounts = [
      {
        'id': 'account',
        'label': '储蓄账户',
        'accountNo': '12344821',
        'currency': 'CNY',
        'balance': 12864075,
        'available': 12864075,
      },
    ];
    session.transactions = [
      {
        'id': 't1',
        'direction': 'in',
        'amount': 1800000,
        'counterparty': '工资入账',
        'createdAt': '2026-10-13T09:00:00Z',
        'status': 'success',
      },
      {
        'id': 't2',
        'direction': 'out',
        'amount': 34000,
        'counterparty': '生活消费',
        'createdAt': '2026-10-13T08:00:00Z',
        'status': 'success',
      },
    ];
    const fontPath = String.fromEnvironment('SCREENSHOT_FONT');
    if (fontPath.isNotEmpty) {
      await tester.runAsync(() async {
        final loader = FontLoader('PreviewFont')
          ..addFont(
            Future.value(
              ByteData.sublistView(await File(fontPath).readAsBytes()),
            ),
          );
        await loader.load();
      });
    }
    await tester.runAsync(() async {
      final icons = FontLoader('packages/lucide_icons/Lucide')
        ..addFont(rootBundle.load('packages/lucide_icons/assets/lucide.ttf'));
      await icons.load();
    });
    final theme = bankTheme();
    final boundaryKey = GlobalKey();
    await tester.pumpWidget(
      MaterialApp(
        theme: fontPath.isEmpty
            ? theme
            : theme.copyWith(
                textTheme: theme.textTheme.apply(fontFamily: 'PreviewFont'),
              ),
        home: RepaintBoundary(
          key: boundaryKey,
          child: Scaffold(
            body: SafeArea(
              child: AccountPage(session: session, onProfile: () {}),
            ),
            bottomNavigationBar: BankNavigation(index: 0, onSelected: (_) {}),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('¥ 128,640.75'), findsOneWidget);
    expect(find.text('转账'), findsOneWidget);
    expect(tester.takeException(), null);
    await tester.runAsync(() async {
      final boundary =
          boundaryKey.currentContext!.findRenderObject()
              as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 2);
      final png = await image.toByteData(format: ui.ImageByteFormat.png);
      await File(
        '/tmp/luckycat-flutter-account.png',
      ).writeAsBytes(png!.buffer.asUint8List());
      image.dispose();
    });
    await tester.tap(find.text('转账'));
    await tester.pumpAndSettle();
    expect(find.text('转入'), findsOneWidget);
    expect(find.text('转出'), findsOneWidget);
    await tester.tap(find.text('转出'));
    await tester.pumpAndSettle();
    expect(find.text('下一步'), findsOneWidget);
    expect(tester.takeException(), null);
    await tester.pumpWidget(const SizedBox());
    session.dispose();
  });
}
