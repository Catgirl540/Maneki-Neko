import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:luckycat/core/api.dart';
import 'package:luckycat/core/chat.dart';
import 'package:luckycat/core/session.dart';

void main() {
  const bank = String.fromEnvironment('LIVE_BANK'),
      agent = String.fromEnvironment('LIVE_AGENT');
  test(
    '真实 Agent：Bearer 会话、SSE 握手、本机历史恢复与卡密排除',
    () async {
      expect(['127.0.0.1', 'localhost'].contains(Uri.parse(bank).host), true);
      expect(['127.0.0.1', 'localhost'].contains(Uri.parse(agent).host), true);
      FlutterSecureStorage.setMockInitialValues({});
      final session = BankSession(Endpoints(bank: bank, agent: agent));
      final sms = object(
        await session.bank.call(
          'api/auth/sms-code',
          method: 'POST',
          body: {'phone': '13800138000'},
        ),
      );
      await session.authenticate(
        object(
          await session.bank.call(
            'api/auth/login',
            method: 'POST',
            body: {
              'phone': '13800138000',
              'password': '123456',
              'smsCode': sms['demoCode'],
            },
          ),
        ),
      );
      Future<void> online(ChatController chat) async {
        for (var n = 0; n < 200 && chat.connectionLabel != '在线'; n++) {
          await Future<void>.delayed(const Duration(milliseconds: 100));
        }
        expect(chat.connectionLabel, '在线', reason: chat.error);
      }

      final chat = ChatController(session);
      await online(chat);
      final id = chat.current!['sessionId'];
      expect(id, isNotEmpty);
      (chat.current!['messages'] as List).add({
        'id': 'm',
        'role': 'user',
        'text': '测试恢复的文字',
      });
      chat.secret = {'value': 'NEVER_PERSIST_CARD_SECRET'};
      final storageKey = chat.storageKey;
      chat.dispose();
      await Future<void>.delayed(const Duration(milliseconds: 100));
      final saved = await const FlutterSecureStorage().read(key: storageKey);
      expect(saved, contains('测试恢复的文字'));
      expect(saved, isNot(contains('NEVER_PERSIST_CARD_SECRET')));
      final restored = ChatController(session);
      await online(restored);
      expect(restored.current!['sessionId'], id);
      expect(restored.messages.single['text'], '测试恢复的文字');
      if (const bool.fromEnvironment('LIVE_AGENT_SEND')) {
        await restored.send('只回复一句你好，不要调用工具。');
        for (
          var n = 0;
          n < 300 &&
              (restored.busy ||
                  !restored.messages.any((m) => m['role'] == 'assistant'));
          n++
        ) {
          await Future<void>.delayed(const Duration(milliseconds: 100));
        }
        expect(restored.error, null);
        expect(
          restored.messages
              .where((m) => m['role'] == 'assistant')
              .single['text'],
          isNotEmpty,
        );
      }
      restored.dispose();
      session.dispose();
    },
    skip: bank.isEmpty || agent.isEmpty
        ? '需指定隔离的 LIVE_BANK 与 LIVE_AGENT'
        : false,
    timeout: const Timeout(Duration(seconds: 60)),
  );
}
