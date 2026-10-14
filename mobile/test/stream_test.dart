import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:luckycat/core/api.dart';

void main() {
  test('真实 SSE 连线先等 hello，完整保留拆包的 UTF-8 回复', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final requests = server.listen((request) async {
      expect(request.headers.value('authorization'), 'Bearer owner');
      request.response.headers.contentType = ContentType(
        'text',
        'event-stream',
      );
      request.response.bufferOutput = false;
      final bytes = utf8.encode(
        'id: 1\r\ndata: {"type":"hello","sessionId":"s"}\r\n\r\nid: 2\r\ndata: {"type":"assistant-update","messageId":"m","text":"转账已受理"}\r\n\r\n',
      );
      for (var i = 0; i < bytes.length; i += 3) {
        request.response.add(bytes.sublist(i, (i + 3).clamp(0, bytes.length)));
      }
      await request.response.flush();
      await request.response.close();
    });
    final api = Api(
      'http://127.0.0.1:${server.port}',
      token: () => 'owner',
      onExpired: () {},
    );
    final stream = AgentStream(api, 's');
    final received = <Json>[];
    final sub = stream.controller.stream.listen(received.add);
    await stream.ready.future.timeout(const Duration(seconds: 3));
    for (var n = 0; n < 30 && received.length < 2; n++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    expect(
      received.firstWhere((e) => e['type'] == 'assistant-update')['text'],
      '转账已受理',
    );
    stream.close();
    await sub.cancel();
    api.close();
    await requests.cancel();
    await server.close(force: true);
  });
  test('代理不支持 SSE 时切到短请求，并携带后续游标', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var polls = 0;
    final requests = server.listen((request) async {
      if (request.uri.path.endsWith('/stream')) {
        request.response.statusCode = 502;
        request.response.write('{}');
      } else {
        polls++;
        expect(request.uri.queryParameters['after'], polls == 1 ? '0' : '7');
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          jsonEncode({
            'cursor': '7',
            'events': polls == 1
                ? [
                    {'type': 'assistant', 'text': '查询完成'},
                  ]
                : [],
          }),
        );
      }
      await request.response.close();
    });
    final api = Api(
      'http://127.0.0.1:${server.port}',
      token: () => 'owner',
      onExpired: () {},
    );
    final stream = AgentStream(api, 's');
    final values = <Json>[];
    final sub = stream.controller.stream.listen(values.add);
    await stream.ready.future.timeout(const Duration(seconds: 3));
    await Future<void>.delayed(const Duration(milliseconds: 900));
    expect(polls, greaterThanOrEqualTo(2));
    expect(values.single['text'], '查询完成');
    stream.close();
    await sub.cancel();
    api.close();
    await requests.cancel();
    await server.close(force: true);
  });
}
