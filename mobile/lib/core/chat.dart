import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'api.dart';
import 'session.dart';

class ChatController extends ChangeNotifier {
  final BankSession session;
  final FlutterSecureStorage storage;
  final String storageKey;
  final List<Json> conversations = [];
  Json? current, health, consent, question, secret;
  AgentStream? _connection;
  StreamSubscription<Json>? _subscription;
  Timer? _saveTimer, _secretTimer;
  bool busy = false, connecting = false, disposed = false;
  String? error, toolStatus;
  String connectionLabel = '连接中';
  int _generation = 0;
  Future<void> _writes = Future<void>.value();
  ChatController(this.session, {FlutterSecureStorage? storage})
    : storage = storage ?? const FlutterSecureStorage(),
      storageKey =
          'luckycat.chat.${Uri.encodeComponent(session.endpoints.bank)}.${session.user!['id']}' {
    unawaited(initialize());
  }
  List<Json> get messages =>
      current == null ? [] : objects(current!['messages']);
  void changed() {
    if (!disposed) notifyListeners();
  }

  Future<void> initialize() async {
    try {
      final raw = await storage.read(key: storageKey);
      if (disposed) return;
      if (raw != null) conversations.addAll(objects(jsonDecode(raw)));
    } catch (_) {
      error = '本机历史记录读取失败，仍可开始新对话';
    }
    if (disposed) return;
    if (conversations.isEmpty) {
      _create();
    } else {
      current = conversations.first;
    }
    changed();
    try {
      health = object(await session.agent.call('agent-api/health'));
      if (health!['ok'] != true) {
        throw const ApiFailure('助手服务尚未就绪，请稍后重试');
      }
      if (health!['bankDataSource'] != 'http') {
        throw const ApiFailure('助手尚未连接当前银行账户服务');
      }
      if (!disposed) await connect();
    } catch (e) {
      if (!disposed) {
        health = null;
        connectionLabel = '未连接';
        error = '$e';
        changed();
      }
    }
  }

  String _id() => DateTime.now().microsecondsSinceEpoch.toString();
  void _create() {
    current = {'id': _id(), 'title': '新对话', 'messages': <Json>[]};
    conversations.insert(0, current!);
    if (conversations.length > 30) conversations.removeLast();
  }

  Future<void> newConversation() async {
    if (busy) throw const ApiFailure('请先停止当前回复');
    disconnect();
    _create();
    error = null;
    _save();
    changed();
    await connect();
  }

  Future<void> select(Json conversation) async {
    if (busy) throw const ApiFailure('请先停止当前回复');
    disconnect();
    current = conversation;
    error = null;
    changed();
    await connect();
  }

  Future<void> remove(Json conversation) async {
    if (busy && conversation['id'] == current?['id']) {
      throw const ApiFailure('请先停止当前回复');
    }
    conversations.removeWhere((c) => c['id'] == conversation['id']);
    if (current?['id'] == conversation['id']) {
      disconnect();
      if (conversations.isEmpty) {
        _create();
      } else {
        current = conversations.first;
      }
      await connect();
    }
    _save();
    changed();
  }

  void disconnect() {
    _generation++;
    _connection?.close();
    _connection = null;
    unawaited(_subscription?.cancel());
    _subscription = null;
    consent = null;
    question = null;
    clearSecret();
    connecting = false;
  }

  Future<void> connect() async {
    if (disposed || current == null || connecting) return;
    if (health == null) {
      health = object(await session.agent.call('agent-api/health'));
      if (health!['ok'] != true) {
        health = null;
        throw const ApiFailure('助手服务尚未就绪，请稍后重试');
      }
      if (health!['bankDataSource'] != 'http') {
        health = null;
        throw const ApiFailure('助手尚未连接银行服务');
      }
    }
    if (disposed) return;
    connecting = true;
    connectionLabel = '连接中';
    changed();
    final gen = _generation;
    final conversation = current!;
    try {
      String? id = conversation['sessionId'];
      if (id != null) {
        Json info;
        try {
          info = object(
            await session.agent.call(
              'agent-api/sessions/${Uri.encodeComponent(id)}',
            ),
          );
        } on ApiFailure catch (e) {
          if (e.status != 404) rethrow;
          info = {'known': false};
        }
        if (info['known'] == false) {
          id = null;
        } else {
          busy = info['busy'] == true;
        }
      }
      if (id == null) {
        final history = objects(conversation['messages'])
            .where(
              (m) =>
                  ['user', 'assistant'].contains(m['role']) &&
                  (m['text'] as String).isNotEmpty,
            )
            .map((m) => {'role': m['role'], 'text': m['text']})
            .toList();
        final result = object(
          await session.agent.call(
            'agent-api/sessions',
            method: 'POST',
            body: history.isEmpty ? {} : {'history': history},
          ),
        );
        id = result['sessionId'] as String?;
        if (id == null || id.isEmpty) throw const ApiFailure('助手没有返回会话标识');
        conversation['sessionId'] = id;
        _save();
      }
      if (gen != _generation || disposed) return;
      final stream = AgentStream(session.agent, id);
      _connection = stream;
      _subscription = stream.controller.stream.listen(
        _event,
        onError: (Object e) {
          if (!disposed) {
            error = '$e';
            changed();
          }
        },
      );
      await stream.ready.future.timeout(const Duration(seconds: 14));
      if (gen == _generation && !disposed) {
        connectionLabel = '在线';
        error = null;
      }
    } catch (e) {
      if (gen == _generation && !disposed) {
        connectionLabel = '未连接';
        error = '$e';
        _connection?.close();
        _connection = null;
        rethrow;
      }
    } finally {
      if (gen == _generation && !disposed) {
        connecting = false;
        changed();
      }
    }
  }

  Future<void> send(String text, {Json? image}) async {
    if (busy || connecting) throw const ApiFailure('请等待当前操作完成');
    if (text.trim().isEmpty && image == null) return;
    if (_connection == null) await connect();
    if (disposed) return;
    final conversation = current!;
    final message = {
      'id': _id(),
      'role': 'user',
      'text': text.trim(),
      if (image != null) 'hasImage': true,
    };
    (conversation['messages'] as List).add(message);
    if (conversation['title'] == '新对话') {
      conversation['title'] = text.trim().isEmpty
          ? '图片对话'
          : text.trim().substring(0, text.trim().length.clamp(0, 20));
    }
    busy = true;
    error = null;
    changed();
    _save();
    try {
      await session.agent.call(
        'agent-api/sessions/${conversation['sessionId']}/messages',
        method: 'POST',
        body: {
          'text': text.trim(),
          if (image != null) ...{
            'image': image,
            'accountId': session.user!['id'],
          },
        },
        timeout: const Duration(seconds: 35),
      );
    } catch (e) {
      if (!disposed) {
        busy = false;
        error = '$e\n发送结果尚未确认，请先查看回复，再决定是否重发。';
        changed();
      }
      rethrow;
    }
  }

  void _event(Json e) {
    if (disposed || current == null) return;
    final type = e['type'];
    switch (type) {
      case 'hello':
        connectionLabel = '在线';
      case 'status':
        busy = e['status'] == 'running';
        if (!busy) {
          toolStatus = null;
          _save();
        }
      case 'assistant':
      case 'assistant-update':
        final list = current!['messages'] as List;
        final id = e['messageId'] ?? _id();
        final index = list.indexWhere((m) => m['id'] == id);
        final row = {
          'id': id,
          'role': 'assistant',
          'text': '${e['text'] ?? ''}',
        };
        if (index < 0) {
          list.add(row);
        } else {
          list[index] = row;
        }
        error = null;
        connectionLabel = '在线';
        _save();
      case 'assistant-reset':
        final list = current!['messages'] as List;
        final i = list.indexWhere((m) => m['id'] == e['messageId']);
        if (i >= 0) list[i]['text'] = '';
      case 'tool-call':
        toolStatus = '正在办理…';
      case 'tool-result':
        toolStatus = null;
      case 'consent':
        consent = object(e['challenge']);
      case 'consent-resolved':
        if (consent?['challengeId'] == e['challengeId']) consent = null;
      case 'question':
        question = object(e['question']);
      case 'question-resolved':
        if (question?['questionId'] == e['questionId']) question = null;
      case 'bank-updated':
        unawaited(session.refresh());
      case 'card-secret':
        secret = e;
        _secretTimer?.cancel();
        final duration = DateTime.fromMillisecondsSinceEpoch(
          (e['expiresAt'] as num).toInt(),
        ).difference(DateTime.now());
        if (duration.isNegative) {
          secret = null;
        } else {
          _secretTimer = Timer(duration, clearSecret);
        }
      case 'stopped':
        busy = false;
        toolStatus = null;
      case 'session-restored':
        if (e['interrupted'] == true) {
          busy = false;
          error = '上次请求已中断，请核对交易结果后再继续';
        }
      case 'error':
        error = '${e['message']}';
        busy = false;
        toolStatus = null;
      case 'connection-warning':
        connectionLabel = '重连中';
    }
    changed();
  }

  void clearSecret() {
    _secretTimer?.cancel();
    secret = null;
    changed();
  }

  Future<void> stop() async {
    await session.agent.call(
      'agent-api/sessions/${current!['sessionId']}/stop',
      method: 'POST',
    );
  }

  Future<void> answerConsent(Json values) async {
    final pending = consent;
    if (pending == null) throw const ApiFailure('本次确认已失效');
    if (DateTime.now().millisecondsSinceEpoch > pending['expiresAt']) {
      throw const ApiFailure('本次确认已过期，请重新发起');
    }
    await session.agent.call(
      'agent-api/consent/${pending['challengeId']}',
      method: 'POST',
      body: values,
      timeout: const Duration(seconds: 25),
    );
  }

  Future<void> answerQuestion(List<Json> answers) async {
    if (question == null) throw const ApiFailure('本次问询已失效');
    await session.agent.call(
      'agent-api/questions/${question!['questionId']}/answer',
      method: 'POST',
      body: {'answers': answers},
    );
  }

  void _save() {
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 500), () {
      unawaited(_persist());
    });
  }

  Future<void> _persist() async {
    try {
      final sanitized = [
        for (final c in conversations)
          {
            'id': c['id'],
            'title': c['title'],
            'sessionId': c['sessionId'],
            'messages': objects(c['messages'])
                .skip(
                  ((c['messages'] as List).length - 200).clamp(
                    0,
                    (c['messages'] as List).length,
                  ),
                )
                .map(
                  (m) => {
                    'id': m['id'],
                    'role': m['role'],
                    'text': m['text'],
                    'hasImage': m['hasImage'] ?? false,
                  },
                )
                .toList(),
          },
      ];
      final value = jsonEncode(sanitized);
      _writes = _writes
          .catchError((_) {})
          .then((_) => storage.write(key: storageKey, value: value));
      await _writes;
    } catch (_) {
      if (!disposed) {
        error = '本机历史记录保存失败';
        changed();
      }
    }
  }

  @override
  void dispose() {
    disposed = true;
    _saveTimer?.cancel();
    _secretTimer?.cancel();
    unawaited(_persist());
    disconnect();
    super.dispose();
  }
}
