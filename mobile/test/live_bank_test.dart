import 'package:flutter_test/flutter_test.dart';
import 'package:luckycat/core/api.dart';

/// Opt-in against an isolated localhost bank, never a server customer database.
void main() {
  const base = String.fromEnvironment('LIVE_BANK');
  test(
    '真实银行 HTTP：鉴权、跨用户转账、卡设置、换汇、理财前置条件与申赎',
    () async {
      expect(
        ['127.0.0.1', 'localhost'].contains(Uri.parse(base).host),
        isTrue,
        reason: '只允许隔离的本机测试银行',
      );
      String token = '';
      final api = Api(base, token: () => token, onExpired: () {});
      Future<Json> login(String phone) async {
        final sms = object(
          await api.call(
            'api/auth/sms-code',
            method: 'POST',
            body: {'phone': phone},
          ),
        );
        return object(
          await api.call(
            'api/auth/login',
            method: 'POST',
            body: {
              'phone': phone,
              'password': '123456',
              'smsCode': sms['demoCode'],
            },
          ),
        );
      }

      final alice = await login('13800138000'),
          bob = await login('13600136000');
      token = bob['token'];
      final other = objects(
        await api.call('api/accounts'),
      ).firstWhere((a) => a['currency'] == 'CNY');
      token = alice['token'];
      final account = objects(
        await api.call('api/accounts'),
      ).firstWhere((a) => a['currency'] == 'CNY');
      final recipient = object(
        await api.call(
          'api/transfers/recipient',
          method: 'POST',
          body: {
            'bankCode': 'LCB',
            'bankRegion': 'CN',
            'accountOrCardNo': other['accountNo'],
            'payeeName': bob['user']['name'],
          },
        ),
      );
      expect(recipient['kind'], 'internal');
      final quote = object(
        await api.call(
          'api/transfers/quote',
          method: 'POST',
          body: {
            'fromAccountId': account['id'],
            'channel': 'bank',
            'scope': 'domestic',
            'amount': 1,
            'bankCode': 'LCB',
            'bankRegion': 'CN',
          },
        ),
      );
      await api.call(
        'api/auth/payment-password/verify',
        method: 'POST',
        body: {'paymentPassword': '888888'},
      );
      final result = object(
        await api.call(
          'api/transfers',
          method: 'POST',
          body: {
            'fromAccountId': account['id'],
            'channel': 'bank',
            'scope': 'domestic',
            'amount': 1,
            'payeeName': bob['user']['name'],
            'payeeAccountNo': other['accountNo'],
            'payeeBankCode': 'LCB',
            'payeeBankRegion': 'CN',
            'memo': 'Flutter isolated integration',
            'confirmedQuote': {
              'version': 1,
              'fromCurrency': 'CNY',
              'fee': quote['fee'],
              'fx': null,
              'submitBefore': DateTime.now()
                  .add(const Duration(seconds: 60))
                  .millisecondsSinceEpoch,
            },
          },
        ),
      );
      expect(result['settlementStatus'], 'success');
      final after = object(await api.call('api/accounts/${account['id']}'));
      expect(after['balance'], account['balance'] - 1 - quote['fee']);
      token = bob['token'];
      expect(
        object(await api.call('api/accounts/${other['id']}'))['balance'],
        other['balance'] + 1,
      );
      token = alice['token'];
      final cards = objects(await api.call('api/cards'));
      final card = cards.firstWhere((c) => c['status'] == 'active');
      final locked = object(
        await api.call(
          'api/cards/${card['id']}/lock',
          method: 'POST',
          body: {'locked': true},
        ),
      );
      expect(locked['status'], 'locked');
      await api.call(
        'api/cards/${card['id']}/lock',
        method: 'POST',
        body: {'locked': false},
      );
      final settings = object(
        await api.call(
          'api/cards/${card['id']}/settings',
          method: 'PATCH',
          body: {'onlinePayment': false},
        ),
      );
      expect(settings['onlinePayment'], false);
      await api.call(
        'api/cards/${card['id']}/settings',
        method: 'PATCH',
        body: {'onlinePayment': card['onlinePayment']},
      );
      final fx = object(
        await api.call(
          'api/exchange/quote',
          method: 'POST',
          body: {
            'fromAccountId': account['id'],
            'toCurrency': 'USD',
            'amount': 100,
          },
        ),
      );
      final exchanged = object(
        await api.call(
          'api/exchange',
          method: 'POST',
          body: {
            'quoteId': fx['quoteId'],
            'fromAccountId': account['id'],
            'toCurrency': 'USD',
            'amount': 100,
            'paymentPassword': '888888',
          },
        ),
      );
      expect(exchanged['fx']['toAmount'], fx['fx']['toAmount']);
      final questions = objects(await api.call('api/wealth/risk/questions'));
      await api.call(
        'api/wealth/risk/assess',
        method: 'POST',
        body: {
          'answers': [
            for (final q in questions) (q['options'] as List).length - 1,
          ],
        },
      );
      final overview = object(await api.call('api/wealth/overview'));
      if (overview['account']['opened'] != true) {
        final sms = object(
          await api.call(
            'api/auth/sms-code',
            method: 'POST',
            body: {'phone': alice['user']['phone']},
          ),
        );
        final verify = object(
          await api.call(
            'api/security/verify',
            method: 'POST',
            body: {'channel': 'face'},
          ),
        );
        await api.call(
          'api/wealth/account/open',
          method: 'POST',
          body: {
            'smsCode': sms['demoCode'],
            'faceTicket': verify['ticket'],
            'settlementAccountId': account['id'],
            'agreement': investmentAgreement,
          },
        );
      }
      final product = objects(
        await api.call('api/wealth/products'),
      ).firstWhere((p) => p['openEnded'] == true);
      final subscription = object(
        await api.call(
          'api/wealth/subscribe',
          method: 'POST',
          body: {
            'productCode': product['code'],
            'amount': product['minAmount'],
            'paymentPassword': '888888',
            'riskAcknowledgement': riskAcknowledgement,
          },
        ),
      );
      expect(subscription['shares'], greaterThan(0));
      final redemption = object(
        await api.call(
          'api/wealth/redeem',
          method: 'POST',
          body: {'holdingId': subscription['holding']['id']},
        ),
      );
      expect(redemption['shares'], greaterThan(0));
      for (final path in [
        'api/security/overview',
        'api/analysis/spending',
        'api/analysis/cashflow',
        'api/receiving',
        'api/autodebits',
      ]) {
        await api.call(path);
      }
      await api.call('api/auth/logout', method: 'POST');
      await expectLater(
        api.call('api/accounts'),
        throwsA(isA<ApiFailure>().having((e) => e.status, 'status', 401)),
      );
      api.close();
    },
    skip: base.isEmpty
        ? '设置 --dart-define=LIVE_BANK=http://127.0.0.1:18080 才运行真实银行联调'
        : false,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
