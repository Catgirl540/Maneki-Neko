import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:luckycat/core/api.dart';
import 'package:luckycat/core/session.dart';
import 'package:luckycat/pages/cards.dart';
import 'package:luckycat/ui/common.dart';

const product = <String, dynamic>{
  'code': 'visa',
  'name': '星享借记卡',
  'network': 'visa',
  'issuingFee': 2300,
  'deliveryFee': 700,
  'deliveryDays': 5,
  'perks': ['全球支付'],
};
Json card([String status = 'active']) => {
  'id': 'c1',
  'productName': '星享借记卡',
  'network': 'visa',
  'theme': 'midnight',
  'cardholder': 'LIN XIAOMAN',
  'last4': '8888',
  'expiry': '08/29',
  'status': status,
  'onlinePayment': true,
  'overseasPayment': false,
  'dailyLimit': 200000,
};
http.Response response(dynamic value, [int status = 200]) => http.Response(
  jsonEncode(value),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('luckycat/files'),
          (_) async => null,
        );
  });
  BankSession session(Future<http.Response> Function(http.Request) handler) {
    final s = BankSession(
      Endpoints(bank: 'https://bank.test'),
      bankClient: MockClient(handler),
    );
    s.token = 'customer-test';
    s.user = {'id': 'u1', 'name': '林小满', 'phone': '13800138000'};
    addTearDown(s.dispose);
    return s;
  }

  Future<void> show(WidgetTester tester, Widget child) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: bankTheme(),
        home: Scaffold(body: child),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tap(WidgetTester tester, String text) async {
    await tester.ensureVisible(find.text(text));
    await tester.pumpAndSettle();
    await tester.tap(find.text(text));
    await tester.pumpAndSettle();
  }

  test('费用不能猜测，限额单位为分，密码必须六位数字', () {
    expect(cardFee(product), 3000);
    expect(() => cardFee({'issuingFee': 2300}), throwsA(isA<ApiFailure>()));
    expect(cardDailyLimits, [200000, 500000, 1000000, 5000000]);
    expect(validCardPassword('123456'), isTrue);
    expect(validCardPassword('abcdef'), isFalse);
  });
  testWidgets('空卡列表提供申卡，空产品列表显示错误', (tester) async {
    final s = session((_) async => response([]));
    await show(tester, CardsPage(session: s));
    expect(find.text('还没有银行卡'), findsOneWidget);
    expect(find.text('去开立账户'), findsNothing);
    await tap(tester, '申请新卡');
    expect(find.text('暂无可申请的银行卡产品'), findsOneWidget);
  });
  testWidgets('每日限额四档且提交分值，不接受任意金额', (tester) async {
    final writes = <http.Request>[];
    final s = session((r) async {
      if (r.method == 'PATCH') writes.add(r);
      return response(card());
    });
    await show(
      tester,
      SingleChildScrollView(
        child: CardControls(session: s, card: card(), reload: () async {}),
      ),
    );
    await tap(tester, '每日限额');
    expect(find.byType(TextFormField), findsNothing);
    await tap(tester, money(500000));
    expect(writes, hasLength(1));
    expect(jsonDecode(writes.single.body), {'dailyLimit': 500000});
    expect(writes.single.headers['Authorization'], 'Bearer customer-test');
  });
  testWidgets('锁卡后支付开关和限额不可改，未接入消费开关不出现', (tester) async {
    final s = session((_) async => response([]));
    await show(
      tester,
      SingleChildScrollView(
        child: CardControls(
          session: s,
          card: card('locked'),
          reload: () async {},
        ),
      ),
    );
    final online = tester.widget<SwitchListTile>(
      find.widgetWithText(SwitchListTile, '网上支付'),
    );
    expect(online.onChanged, isNull);
    expect(find.text('消费开关'), findsNothing);
    expect(
      tester.widget<ListTile>(find.widgetWithText(ListTile, '每日限额')).onTap,
      isNull,
    );
  });
  testWidgets('待激活卡不能解锁，换卡仍有明确入口', (tester) async {
    final s = session((_) async => response([]));
    await show(
      tester,
      SingleChildScrollView(
        child: CardControls(
          session: s,
          card: card('pending'),
          reload: () async {},
        ),
      ),
    );
    expect(find.text('待激活'), findsOneWidget);
    expect(
      tester
          .widget<SwitchListTile>(find.widgetWithText(SwitchListTile, '锁定银行卡'))
          .onChanged,
      isNull,
    );
    expect(
      tester.widget<ListTile>(find.widgetWithText(ListTile, '更换银行卡')).onTap,
      isNotNull,
    );
  });
  testWidgets('换卡在提交前展示匹配产品费用和旧卡失效说明', (tester) async {
    var writes = 0;
    final s = session((r) async {
      if (r.method == 'POST') writes++;
      return response([product]);
    });
    await show(
      tester,
      SingleChildScrollView(
        child: CardControls(session: s, card: card(), reload: () async {}),
      ),
    );
    await tap(tester, '更换银行卡');
    expect(find.text('支付 ${money(3000)} 并换卡'), findsOneWidget);
    expect(find.textContaining('旧卡立即失效'), findsOneWidget);
    expect(writes, 0);
  });
  testWidgets('地址和密码校验失败不发申请', (tester) async {
    var writes = 0;
    final s = session((_) async {
      writes++;
      return response({});
    });
    await show(
      tester,
      AddressForm(
        session: s,
        title: '申请新卡',
        path: 'api/cards/open',
        product: product,
      ),
    );
    final fields = find.byType(TextFormField);
    for (final (index, text) in [
      (0, '林小满'),
      (1, '13800138000'),
      (2, '上海市'),
      (3, '上海市'),
      (4, '短'),
      (6, '12345'),
    ]) {
      await tester.ensureVisible(fields.at(index));
      await tester.enterText(fields.at(index), text);
    }
    await tap(tester, '支付 ${money(3000)} 并申请');
    expect(find.text('详细地址至少 5 个字'), findsOneWidget);
    expect(find.text('请输入 6 位数字支付密码'), findsOneWidget);
    expect(writes, 0);
  });
  testWidgets('申卡失败保留地址，密码重输后只提交一次新请求', (tester) async {
    final writes = <Json>[];
    final s = session((r) async {
      writes.add(object(jsonDecode(r.body)));
      return writes.length == 1
          ? response({'message': '支付密码不正确', 'code': 'BAD_PAY_PASSWORD'}, 401)
          : response(card('pending'));
    });
    await show(
      tester,
      Builder(
        builder: (context) => TextButton(
          onPressed: () => sheet(
            context,
            AddressForm(
              session: s,
              title: '申请新卡',
              path: 'api/cards/open',
              product: product,
              extra: const {'productCode': 'visa'},
            ),
          ),
          child: const Text('开始申请'),
        ),
      ),
    );
    await tap(tester, '开始申请');
    final fields = find.byType(TextFormField);
    for (final (index, text) in [
      (2, '上海市'),
      (3, '上海市'),
      (4, '测试路 100 号'),
      (6, '123456'),
    ]) {
      await tester.ensureVisible(fields.at(index));
      await tester.pumpAndSettle();
      await tester.enterText(fields.at(index), text);
    }
    await tap(tester, '支付 ${money(3000)} 并申请');
    expect(writes, hasLength(1));
    expect(
      tester.widget<TextFormField>(fields.at(6)).controller!.text,
      isEmpty,
    );
    expect(
      tester.widget<TextFormField>(fields.at(4)).controller!.text,
      '测试路 100 号',
    );
    await tester.enterText(fields.at(6), '123456');
    await tap(tester, '支付 ${money(3000)} 并申请');
    expect(writes, hasLength(2));
    expect(writes.last['productCode'], 'visa');
    expect(writes.last['paymentPassword'], '123456');
    expect(object(writes.last['address'])['phone'], '13800138000');
  });
  Future<void> openSecret(WidgetTester tester, BankSession s) async {
    await show(
      tester,
      Builder(
        builder: (context) => TextButton(
          onPressed: () => showDialog(
            context: context,
            builder: (_) => SecretDialog(session: s, id: 'c1'),
          ),
          child: const Text('打开'),
        ),
      ),
    );
    await tap(tester, '打开');
    await tester.enterText(find.byType(TextField), '123456');
    await tester.tap(find.text('验证并查看'));
    await tester.pump();
  }

  testWidgets('卡信息按服务端时长隐藏', (tester) async {
    final s = session(
      (_) async => response({
        'pan': '4026880000008888',
        'expiry': '08/29',
        'cvv': '123',
        'revealSeconds': 1,
      }),
    );
    await openSecret(tester, s);
    await tester.pumpAndSettle();
    expect(find.text('4026880000008888'), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
    expect(find.text('4026880000008888'), findsNothing);
    await tap(tester, '关闭');
  });
  testWidgets('切后台后晚到的卡密不能重新显示', (tester) async {
    final pending = Completer<http.Response>();
    final s = session((_) => pending.future);
    await openSecret(tester, s);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    pending.complete(
      response({
        'pan': '4026880000008888',
        'cvv': '123',
        'expiry': '08/29',
        'revealSeconds': 30,
      }),
    );
    await tester.pumpAndSettle();
    expect(find.text('4026880000008888'), findsNothing);
    expect(tester.takeException(), isNull);
    await tap(tester, '关闭');
  });
  testWidgets('关闭弹窗后请求完成不访问已销毁密码框', (tester) async {
    final pending = Completer<http.Response>();
    final s = session((_) => pending.future);
    await openSecret(tester, s);
    await tap(tester, '关闭');
    pending.complete(
      response({
        'pan': '4026880000008888',
        'cvv': '123',
        'expiry': '08/29',
        'revealSeconds': 30,
      }),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('4026880000008888'), findsNothing);
  });
  testWidgets('窄屏大字体卡管理不溢出', (tester) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 1.5;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final s = session((_) async => response([card()]));
    await show(tester, CardsPage(session: s));
    expect(tester.takeException(), isNull);
    await tap(tester, '每日限额');
    expect(find.text(money(500000)), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
