import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:luckycat/core/api.dart';
import 'package:luckycat/core/session.dart';
import 'package:luckycat/pages/cards.dart';
import 'package:luckycat/ui/common.dart';
import 'cards_test.dart' as fixtures;

void main() {
  testWidgets('Flutter 银行卡界面预览', (tester) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final session = BankSession(
      Endpoints(bank: 'https://bank.test'),
      bankClient: MockClient((_) async => fixtures.response([fixtures.card()])),
    );
    session.token = 'test';
    session.user = {'id': 'u1', 'name': '林小满'};
    addTearDown(session.dispose);
    const fontPath = String.fromEnvironment('SCREENSHOT_FONT');
    if (fontPath.isNotEmpty) {
      await tester.runAsync(() async {
        final font = FontLoader('PreviewFont')
          ..addFont(
            Future.value(
              ByteData.sublistView(await File(fontPath).readAsBytes()),
            ),
          );
        await font.load();
        final icons = FontLoader('packages/lucide_icons/Lucide')
          ..addFont(rootBundle.load('packages/lucide_icons/assets/lucide.ttf'));
        await icons.load();
      });
    }
    final key = GlobalKey();
    final theme = bankTheme();
    await tester.pumpWidget(
      MaterialApp(
        theme: fontPath.isEmpty
            ? theme
            : theme.copyWith(
                textTheme: theme.textTheme.apply(fontFamily: 'PreviewFont'),
              ),
        home: RepaintBoundary(
          key: key,
          child: Scaffold(
            appBar: AppBar(title: const Text('银行卡')),
            body: CardsPage(session: session),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    if (fontPath.isNotEmpty) {
      await tester.runAsync(() async {
        final boundary =
            key.currentContext!.findRenderObject() as RenderRepaintBoundary;
        final image = await boundary.toImage(pixelRatio: 2);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await File(
          '/tmp/maneki-flutter-cards.png',
        ).writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
    }
    await tester.pumpWidget(const SizedBox());
  });
}
