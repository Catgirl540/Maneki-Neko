import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'api.dart';

class BankSession extends ChangeNotifier {
  final Endpoints endpoints;
  late final Api bank;
  late final Api agent;
  String token = '';
  Json? user;
  List<Json> accounts = [];
  List<Json> transactions = [];
  String? selectedId;
  Object? error;
  bool loading = false;
  int revision = 0, _generation = 0;
  BankSession(
    this.endpoints, {
    http.Client? bankClient,
    http.Client? agentClient,
  }) {
    bank = Api(
      endpoints.bank,
      token: () => token,
      onExpired: expire,
      client: bankClient,
    );
    agent = Api(
      endpoints.agent,
      token: () => token,
      onExpired: expire,
      client: agentClient,
    );
  }
  Json? get account =>
      accounts.where((a) => a['id'] == selectedId).firstOrNull ??
      accounts.firstOrNull;
  Future<void> authenticate(Json response) async {
    final next = response['token'];
    if (next is! String || next.isEmpty) throw const ApiFailure('登录响应缺少身份令牌');
    user = object(response['user']);
    token = next;
    _generation++;
    notifyListeners();
    await refresh();
  }

  Future<void> refresh() async {
    if (token.isEmpty) return;
    final gen = ++_generation;
    loading = true;
    error = null;
    notifyListeners();
    try {
      final result = objects(await bank.call('api/accounts'));
      if (gen != _generation) return;
      accounts = result;
      selectedId = account?['id'] as String?;
      if (account != null) {
        final rows = object(
          await bank.call(
            'api/accounts/${account!['id']}/transactions',
            query: {'page': '1', 'size': '5'},
          ),
        );
        if (gen != _generation) return;
        transactions = objects(rows['items']);
      } else {
        transactions = [];
      }
      revision++;
    } catch (e) {
      if (gen == _generation) error = e;
    } finally {
      if (gen == _generation) {
        loading = false;
        notifyListeners();
      }
    }
  }

  void expire() {
    _generation++;
    token = '';
    user = null;
    accounts = [];
    transactions = [];
    selectedId = null;
    error = null;
    loading = false;
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      await bank.call('api/auth/logout', method: 'POST');
    } finally {
      expire();
    }
  }

  @override
  void dispose() {
    bank.close();
    agent.close();
    super.dispose();
  }
}
