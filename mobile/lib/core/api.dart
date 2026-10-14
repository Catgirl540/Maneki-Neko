import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;

typedef Json = Map<String, dynamic>;
Json object(dynamic value) {
  if (value is! Map) throw const ApiFailure('服务返回的数据格式不正确');
  return Map<String, dynamic>.from(value);
}

List<Json> objects(dynamic value) {
  if (value is! List) throw const ApiFailure('服务返回的数据格式不正确');
  return value.map(object).toList();
}

class ApiFailure implements Exception {
  final String message;
  final int status;
  final String? code;
  const ApiFailure(this.message, [this.status = 0, this.code]);
  bool get outcomeUnknown =>
      ['TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE'].contains(code);
  @override
  String toString() => message;
}

class Endpoints {
  final String bank, agent;
  Endpoints({String? bank, String? agent})
    : bank = normalize(
        bank ??
            const String.fromEnvironment(
              'BANK_BASE_URL',
              defaultValue: 'http://120.48.123.112/bank',
            ),
      ),
      agent = normalize(
        agent ??
            const String.fromEnvironment(
              'AGENT_BASE_URL',
              defaultValue: 'http://120.48.123.112/bank',
            ),
      );
  static String normalize(String value) {
    final uri = Uri.tryParse(value.trim());
    if (uri == null ||
        !['https', 'http'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw const ApiFailure('请输入有效的服务地址');
    }
    if (RegExp(r'/(api|agent-api)/?$').hasMatch(uri.path)) {
      throw const ApiFailure('服务地址不需要添加 /api 或 /agent-api');
    }
    return uri.toString().replaceFirst(RegExp(r'/+$'), '');
  }
}

class Api {
  final String base;
  final String Function() token;
  final void Function() onExpired;
  final http.Client client;
  Api(
    this.base, {
    required this.token,
    required this.onExpired,
    http.Client? client,
  }) : client = client ?? http.Client();
  Uri uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$base/$path').replace(queryParameters: query);
  Map<String, String> get headers => {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    if (token().isNotEmpty) 'Authorization': 'Bearer ${token()}',
  };
  Future<dynamic> call(
    String path, {
    String method = 'GET',
    dynamic body,
    Map<String, String>? query,
    Duration timeout = const Duration(seconds: 15),
  }) async {
    try {
      final req = http.Request(method, uri(path, query))
        ..headers.addAll(headers);
      if (body != null) req.body = jsonEncode(body);
      final response = await client
          .send(req)
          .then(http.Response.fromStream)
          .timeout(timeout);
      return decode(response);
    } on ApiFailure {
      rethrow;
    } on TimeoutException {
      throw const ApiFailure('服务响应超时，请重试', 0, 'TIMEOUT');
    } catch (_) {
      throw const ApiFailure('无法连接服务，请检查网络', 0, 'NETWORK_ERROR');
    }
  }

  dynamic decode(http.Response response) {
    dynamic payload;
    try {
      payload = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      throw ApiFailure(
        '服务返回了无效响应，请检查服务地址',
        response.statusCode,
        'INVALID_RESPONSE',
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final data = payload is Map ? payload : <String, dynamic>{};
      if (response.statusCode == 401 && data['code'] == 'UNAUTHORIZED') {
        onExpired();
      }
      throw ApiFailure(
        '${data['message'] ?? data['error'] ?? '请求失败'}',
        response.statusCode,
        data['code'] as String?,
      );
    }
    return payload;
  }

  Future<Uint8List> speech(String text) async {
    final req = http.Request('POST', uri('agent-api/tts'))
      ..headers.addAll(headers)
      ..body = jsonEncode({'text': text});
    try {
      final response = await client
          .send(req)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 60));
      if (response.statusCode != 200) decode(response);
      if (!(response.headers['content-type'] ?? '').startsWith('audio/')) {
        throw const ApiFailure('语音服务返回格式无效');
      }
      return response.bodyBytes;
    } on TimeoutException {
      throw const ApiFailure('语音合成超时');
    }
  }

  void close() => client.close();
}

/// Handles CRLF, multiline data, comments and UTF-8 split across network chunks.
class SseParser {
  final List<String> _data = [];
  String? _id;
  Json? line(String line) {
    if (line.isEmpty) {
      final data = _data.join('\n');
      final id = _id;
      _data.clear();
      _id = null;
      if (data.isEmpty) return null;
      try {
        final result = object(jsonDecode(data));
        return {...result, '_eventId': ?id};
      } catch (_) {
        return null;
      }
    }
    if (line.startsWith('data:')) {
      _data.add(line.substring(5).replaceFirst(RegExp(r'^ '), ''));
    }
    if (line.startsWith('id:')) _id = line.substring(3).trim();
    return null;
  }
}

/// One subscription per conversation. Wait for hello before sending a prompt.
/// A broken SSE connection resumes from the server cursor via short requests.
class AgentStream {
  final Api api;
  final String sessionId;
  final controller = StreamController<Json>();
  final ready = Completer<void>();
  http.Client? _streamClient;
  String _cursor = '0';
  bool _closed = false;
  AgentStream(this.api, this.sessionId) {
    unawaited(_run());
  }
  void _receive(Json event) {
    final id = event.remove('_eventId')?.toString();
    if (id != null) {
      final next = int.tryParse(id);
      final current = int.tryParse(_cursor);
      if (next != null &&
          current != null &&
          next <= current &&
          event['type'] != 'hello') {
        return;
      }
      _cursor = id;
    }
    if (!ready.isCompleted && event['type'] == 'hello') ready.complete();
    if (!_closed) controller.add(event);
  }

  Future<void> _run() async {
    // Register the error handler immediately; UI will also await ready.
    unawaited(ready.future.catchError((_) {}));
    try {
      _streamClient = http.Client();
      final req = http.Request(
        'GET',
        api.uri('agent-api/sessions/${Uri.encodeComponent(sessionId)}/stream'),
      )..headers.addAll({...api.headers, 'Accept': 'text/event-stream'});
      final timer = Timer(
        const Duration(seconds: 5),
        () => _streamClient?.close(),
      );
      try {
        final response = await _streamClient!
            .send(req)
            .timeout(const Duration(seconds: 5));
        if (response.statusCode != 200 ||
            !(response.headers['content-type'] ?? '').contains(
              'text/event-stream',
            )) {
          api.decode(await http.Response.fromStream(response));
          throw const ApiFailure('事件流不可用');
        }
        final parser = SseParser();
        await for (final line
            in response.stream
                .transform(utf8.decoder)
                .transform(const LineSplitter())
                .timeout(const Duration(seconds: 60))) {
          if (_closed) break;
          final event = parser.line(line);
          if (event != null) {
            if (event['type'] == 'hello') timer.cancel();
            _receive(event);
          }
        }
      } finally {
        timer.cancel();
        _streamClient?.close();
      }
    } catch (error) {
      if (error is ApiFailure && error.status == 401) {
        if (!ready.isCompleted) ready.completeError(error);
        close();
        return;
      }
    }
    while (!_closed) {
      try {
        final body = object(
          await api.call(
            'agent-api/sessions/${Uri.encodeComponent(sessionId)}/events',
            query: {'after': _cursor},
            timeout: const Duration(seconds: 8),
          ),
        );
        final events = objects(body['events']);
        if (!RegExp(r'^\d+$').hasMatch('${body['cursor']}')) {
          throw const ApiFailure('事件游标无效');
        }
        if (!ready.isCompleted) ready.complete();
        for (final event in events) {
          _receive(event);
        }
        _cursor = '${body['cursor']}';
      } catch (error) {
        if (_closed) break;
        if (error is ApiFailure && error.status == 401) {
          if (!ready.isCompleted) ready.completeError(error);
          close();
          return;
        }
        controller.add({'type': 'connection-warning', 'message': '连接中断，正在重连'});
      }
      await Future<void>.delayed(const Duration(milliseconds: 750));
    }
  }

  void close() {
    if (_closed) return;
    _closed = true;
    _streamClient?.close();
    if (!ready.isCompleted) ready.completeError(const ApiFailure('连接已关闭'));
    unawaited(controller.close());
  }
}

int parseCents(String input) {
  final value = input.trim();
  if (!RegExp(r'^\d{1,10}(\.\d{1,2})?$').hasMatch(value)) {
    throw const ApiFailure('请输入有效金额，最多两位小数');
  }
  final parts = value.split('.');
  final cents =
      int.parse(parts[0]) * 100 +
      (parts.length == 2 ? int.parse(parts[1].padRight(2, '0')) : 0);
  if (cents <= 0) throw const ApiFailure('金额必须大于零');
  return cents;
}

String money(dynamic cents, {String currency = 'CNY'}) {
  if (cents is! num) return '—';
  final sign = cents < 0 ? '-' : '';
  final raw = (cents.abs() / 100).toStringAsFixed(2).split('.');
  final whole = raw[0].replaceAllMapped(
    RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
    (m) => '${m[1]},',
  );
  return '$sign${{'CNY': '¥', 'HKD': 'HK\$', 'USD': 'US\$'}[currency] ?? currency} $whole.${raw[1]}';
}

String dateText(dynamic value) {
  final date = DateTime.tryParse('$value')?.toLocal();
  if (date == null) return '—';
  return '${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
}

String statusText(dynamic value) =>
    const {
      'success': '已到账',
      'pending': '处理中',
      'failed': '未完成',
      'active': '正常',
      'locked': '已锁定',
      'replaced': '已更换',
    }[value] ??
    '$value';
const openingPledge = '本人充分了解并清楚知晓出租、出借、出售、购买账户的相关法律责任和惩戒措施，承诺依法依规开立和使用本人账户';
const investmentAgreement =
    '本人已阅读并同意《理财产品投资协议》《风险揭示书》及《投资者权益须知》，自愿开立理财账户并独立承担投资风险';
const riskAcknowledgement = '本人已经阅读风险揭示，愿意承担投资风险';
