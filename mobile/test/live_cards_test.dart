import 'package:flutter_test/flutter_test.dart';
import 'package:luckycat/core/api.dart';
import 'package:luckycat/pages/cards.dart';

void main() {
  const base = String.fromEnvironment('LIVE_BANK');
  test(
    '隔离银行：申卡和换卡实际费用、旧卡失效及卡信息协议',
    () async {
      expect(['127.0.0.1', 'localhost'].contains(Uri.parse(base).host), isTrue);
      String token = '';
      final api = Api(base, token: () => token, onExpired: () {});
      addTearDown(api.close);
      const phone = '13800138000';
      final sms = object(
        await api.call(
          'api/auth/sms-code',
          method: 'POST',
          body: {'phone': phone},
        ),
      );
      token = object(
        await api.call(
          'api/auth/login',
          method: 'POST',
          body: {
            'phone': phone,
            'password': '123456',
            'smsCode': sms['demoCode'],
          },
        ),
      )['token'];
      final products = objects(await api.call('api/cards/products'));
      final account = objects(
        await api.call('api/accounts'),
      ).firstWhere((a) => a['currency'] == 'CNY');
      final active = objects(
        await api.call('api/cards'),
      ).firstWhere((c) => c['status'] == 'active');
      const address = {
        'recipient': '测试客户',
        'phone': phone,
        'region': '上海市',
        'city': '上海市',
        'detail': '测试路 100 号',
      };
      final product = products.first;
      final opened = object(
        await api.call(
          'api/cards/open',
          method: 'POST',
          body: {
            'productCode': product['code'],
            'address': address,
            'paymentPassword': '888888',
          },
        ),
      );
      expect(opened['status'], 'pending');
      expect(opened['issuingFee'], cardFee(product));
      final replacementProduct = products.firstWhere(
        (p) => p['network'] == active['network'],
      );
      final replacement = object(
        await api.call(
          'api/cards/${active['id']}/replace',
          method: 'POST',
          body: {'address': address, 'paymentPassword': '888888'},
        ),
      );
      expect(replacement['status'], 'pending');
      final cards = objects(await api.call('api/cards'));
      expect(
        cards.firstWhere((c) => c['id'] == active['id'])['status'],
        'replaced',
      );
      expect(
        object(await api.call('api/accounts/${account['id']}'))['balance'],
        account['balance'] - cardFee(product) - cardFee(replacementProduct),
      );
      await expectLater(
        api.call(
          'api/cards/${opened['id']}/secrets',
          method: 'POST',
          body: {'paymentPassword': '888888'},
        ),
        throwsA(
          isA<ApiFailure>().having((e) => e.code, 'code', 'CARD_NOT_DELIVERED'),
        ),
      );
      final remaining = cards.firstWhere((c) => c['status'] == 'locked');
      final secrets = object(
        await api.call(
          'api/cards/${remaining['id']}/secrets',
          method: 'POST',
          body: {'paymentPassword': '888888'},
        ),
      );
      expect(secrets['pan'], isA<String>());
      expect(secrets['revealSeconds'], greaterThan(0));
    },
    skip: base.isEmpty ? '设置 LIVE_BANK 才运行隔离的银行卡联调' : false,
  );
}
