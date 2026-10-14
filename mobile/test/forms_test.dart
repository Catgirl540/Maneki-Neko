import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:luckycat/core/api.dart';
import 'package:luckycat/ui/common.dart';

void main() {
  testWidgets('金融提交结果不明时停止重复提交并清除密码', (tester) async {
    var calls = 0;
    String? sent;
    await tester.pumpWidget(
      MaterialApp(
        theme: bankTheme(),
        home: Scaffold(
          body: ActionForm(
            title: '测试',
            fields: const [FormFieldSpec('password', '支付密码', secret: true)],
            submit: (v) async {
              calls++;
              sent = v['password'];
              throw const ApiFailure('网络中断', 0, 'NETWORK_ERROR');
            },
          ),
        ),
      ),
    );
    await tester.enterText(find.byType(TextFormField), ' 123456 ');
    await tester.tap(find.text('确认提交'));
    await tester.pumpAndSettle();
    expect(sent, ' 123456 ');
    expect(calls, 1);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      null,
    );
    expect(
      tester.widget<TextFormField>(find.byType(TextFormField)).controller!.text,
      isEmpty,
    );
    expect(find.text('提交结果尚未确认，请先核对账户或申请记录。'), findsOneWidget);
  });
}
