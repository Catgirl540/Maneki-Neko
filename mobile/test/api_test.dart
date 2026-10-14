import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:luckycat/core/api.dart';
import 'package:luckycat/core/session.dart';

void main() {
  test('金额使用整数分，不接受指数、负数、精度溢出', () {
    expect(parseCents('0.01'), 1);
    expect(parseCents('12.3'), 1230);
    expect(parseCents('9999999999.99'), 999999999999);
    for (final value in ['0', '-1', '1e3', '1.001', 'NaN', '1,000', '']) {
      expect(() => parseCents(value), throwsA(isA<ApiFailure>()));
    }
    expect(money(123456), '¥ 1,234.56');
    expect(money(null), '—');
    expect(money(-123, currency: 'HKD'), '-HK\$ 1.23');
  });
  test('服务地址支持反代前缀，拒绝重复 API 前缀与凭据', () {
    final endpoints = Endpoints(
      bank: 'https://bank.example/bank/',
      agent: 'https://agent.example/',
    );
    expect(endpoints.bank, 'https://bank.example/bank');
    expect(endpoints.agent, 'https://agent.example');
    for (final value in [
      'garbage',
      'https://bank.example/api',
      'https://bank.example/agent-api/',
      'https://user:pass@bank.example',
    ]) {
      expect(() => Endpoints(bank: value), throwsA(isA<ApiFailure>()));
    }
  });
  test('银行与助手共用用户 Bearer 身份，银行请求拼接反代前缀', () async {
    final client = MockClient((request) async {
      expect(request.headers['Authorization'], 'Bearer customer');
      expect(request.url.path, '/bank/api/accounts');
      return http.Response('[]', 200);
    });
    final api = Api(
      'https://bank.example/bank',
      token: () => 'customer',
      onExpired: () {},
      client: client,
    );
    expect(await api.call('api/accounts'), isEmpty);
    api.close();
  });
  test('支付密码错误 401 可重试；只有登录身份失效才退出', () async {
    var expired = 0;
    final api = Api(
      'https://bank.example',
      token: () => 'customer',
      onExpired: () => expired++,
      client: MockClient(
        (r) async => http.Response(
          jsonEncode({
            'message': 'bad',
            'code': r.url.path.contains('consent')
                ? 'BAD_PASSWORD'
                : 'UNAUTHORIZED',
          }),
          401,
        ),
      ),
    );
    await expectLater(
      api.call(
        'agent-api/consent/id',
        method: 'POST',
        body: {'paymentPassword': '000000'},
      ),
      throwsA(isA<ApiFailure>()),
    );
    expect(expired, 0);
    await expectLater(api.call('api/accounts'), throwsA(isA<ApiFailure>()));
    expect(expired, 1);
    api.close();
  });
  test('HTML 代理错误不会被当作有效业务数据', () async {
    final api = Api(
      'https://bank.example',
      token: () => '',
      onExpired: () {},
      client: MockClient(
        (r) async => http.Response('<html>other app</html>', 200),
      ),
    );
    await expectLater(api.call('api/accounts'), throwsA(isA<ApiFailure>()));
    api.close();
  });
  test('SSE 多行 JSON、心跳、重置事件与游标', () {
    final parser = SseParser();
    expect(parser.line(': ping'), null);
    expect(parser.line(''), null);
    parser.line('id: 42');
    parser.line('data: {"type":"assistant-update",');
    parser.line('data: "messageId":"m1","text":"你好"}');
    expect(parser.line(''), {
      'type': 'assistant-update',
      'messageId': 'm1',
      'text': '你好',
      '_eventId': '42',
    });
    parser.line('data: {"type":"assistant-reset","messageId":"m1"}');
    expect(parser.line('')?['type'], 'assistant-reset');
    parser.line('data: invalid');
    expect(parser.line(''), null);
  });
  test('较晚返回的旧账户请求不覆盖新账户选择', () async {
    final session = BankSession(
      Endpoints(bank: 'https://bank.example'),
      bankClient: MockClient((r) async {
        if (r.url.path == '/api/accounts') {
          return http.Response(
            '[{"id":"a","currency":"CNY"},{"id":"b","currency":"HKD"}]',
            200,
          );
        }
        if (r.url.path.contains('/a/')) {
          await Future<void>.delayed(const Duration(milliseconds: 30));
        }
        return http.Response(
          jsonEncode({
            'items': [
              {'accountId': r.url.path.contains('/a/') ? 'a' : 'b'},
            ],
          }),
          200,
        );
      }),
    );
    session.token = 'token';
    session.selectedId = 'a';
    final first = session.refresh();
    await Future<void>.delayed(const Duration(milliseconds: 5));
    session.selectedId = 'b';
    await session.refresh();
    await first;
    expect(session.account?['id'], 'b');
    expect(session.transactions.single['accountId'], 'b');
    session.dispose();
  });
}
