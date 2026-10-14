import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../ui/common.dart';

class TransferChooser extends StatelessWidget {
  final BankSession session;
  const TransferChooser({super.key, required this.session});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          '转账',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 18),
        for (final (label, icon, incoming) in [
          ('转入', LucideIcons.arrowDownLeft, true),
          ('转出', LucideIcons.arrowUpRight, false),
        ])
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Surface(
              padding: EdgeInsets.zero,
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 18,
                  vertical: 12,
                ),
                leading: Icon(icon, color: Palette.goldInk),
                title: Text(
                  label,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                trailing: const Icon(LucideIcons.chevronRight, size: 20),
                onTap: () {
                  final navigator = Navigator.of(context);
                  navigator.pop();
                  Future<void>.delayed(Duration.zero, () {
                    if (!navigator.mounted) return;
                    sheet(
                      navigator.context,
                      incoming
                          ? DepositSheet(session: session)
                          : TransferSheet(session: session),
                    );
                  });
                },
              ),
            ),
          ),
      ],
    ),
  );
}

class DepositSheet extends StatelessWidget {
  final BankSession session;
  const DepositSheet({super.key, required this.session});
  @override
  Widget build(BuildContext context) => ActionForm(
    title: '转入',
    fields: const [
      FormFieldSpec(
        'amount',
        '转入金额',
        keyboard: TextInputType.numberWithOptions(decimal: true),
      ),
    ],
    introduction: pair(
      '入账账户',
      '${session.account?['label']} · ${session.account?['currency']}',
    ),
    submit: (v) async {
      final amount = parseCents(v['amount']!);
      if (!await confirm(
        context,
        '确认转入',
        money(amount, currency: session.account!['currency']),
      )) {
        throw const ApiFailure('已取消');
      }
      final result = await session.bank.call(
        'api/accounts/${session.account!['id']}/deposit',
        method: 'POST',
        body: {'amount': amount, 'channel': 'bank'},
      );
      await session.refresh();
      return result;
    },
    success: (_) => '转入已完成',
  );
}

class TransferSheet extends StatefulWidget {
  final BankSession session;
  const TransferSheet({super.key, required this.session});
  @override
  State<TransferSheet> createState() => _TransferSheetState();
}

class _TransferSheetState extends State<TransferSheet> {
  final name = TextEditingController(),
      identifier = TextEditingController(),
      amount = TextEditingController(),
      memo = TextEditingController(),
      password = TextEditingController();
  List<Json> banks = [], payees = [];
  String channel = 'bank',
      region = 'CN',
      currency = 'HKD',
      fpsMethod = 'mobile';
  String? bankCode;
  bool busy = false, uncertain = false;
  Object? error;
  Json? quote, draft, result;
  DateTime? deadline;
  BankSession get s => widget.session;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() => busy = true);
    try {
      final values = await Future.wait([
        s.bank.call('api/banks'),
        s.bank.call('api/payees'),
      ]);
      if (mounted) {
        setState(() {
          banks = objects(values[0]);
          payees = objects(values[1]);
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    for (final c in [name, identifier, amount, memo, password]) {
      c.clear();
      c.dispose();
    }
    super.dispose();
  }

  Future<void> next() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final cents = parseCents(amount.text);
      if (s.account == null) throw const ApiFailure('请先选择付款账户');
      String payeeName = name.text.trim();
      Json? resolved;
      if (identifier.text.trim().isEmpty) throw const ApiFailure('请填写收款标识');
      if (channel == 'fps' && fpsMethod != 'account') {
        resolved = object(
          await s.bank.call(
            'api/fps/resolve',
            method: 'POST',
            body: {'idType': fpsMethod, 'fpsId': identifier.text.trim()},
          ),
        );
        if (resolved['registered'] != true) {
          throw ApiFailure('${resolved['reason'] ?? '该标识未登记转数快'}');
        }
        payeeName = resolved['name'];
        bankCode = resolved['bankCode'];
        region = 'HK';
      } else {
        if (bankCode == null || payeeName.isEmpty) {
          throw const ApiFailure('请填写收款人并选择银行');
        }
        await s.bank.call(
          'api/transfers/recipient',
          method: 'POST',
          body: {
            'bankCode': bankCode,
            'bankRegion': region,
            'accountOrCardNo': identifier.text.trim(),
            'payeeName': payeeName,
          },
        );
      }
      final request = <String, dynamic>{
        'fromAccountId': s.account!['id'],
        'channel': channel,
        'scope': region == 'CN' ? 'domestic' : 'overseas',
        'payeeName': payeeName,
        'payeeBankCode': bankCode,
        'payeeBankRegion': region,
        'amount': cents,
        'memo': memo.text.trim(),
        if (channel == 'bank' || fpsMethod == 'account')
          'payeeAccountNo': identifier.text.trim(),
        if (channel == 'fps') ...{
          'fpsMethod': fpsMethod,
          'payeeCurrency': currency,
          if (fpsMethod != 'account') 'fpsId': identifier.text.trim(),
        },
        if (resolved != null)
          'confirmedRecipient': {
            'name': payeeName,
            'bankCode': bankCode,
            'bankRegion': 'HK',
          },
      };
      final price = object(
        await s.bank.call(
          'api/transfers/quote',
          method: 'POST',
          body: {
            'fromAccountId': request['fromAccountId'],
            'channel': channel,
            'scope': request['scope'],
            'amount': cents,
            'bankCode': bankCode,
            'bankRegion': region,
            if (channel == 'fps') 'payeeCurrency': currency,
          },
        ),
      );
      if (cents > (price['maxAmount'] as num) ||
          cents > (price['singleLimit'] as num)) {
        throw const ApiFailure('金额超过当前可转额度');
      }
      if (mounted) {
        setState(() {
          quote = price;
          draft = request;
          deadline = DateTime.now().add(
            Duration(seconds: price['fx']?['quoteTtlSeconds'] ?? 60),
          );
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> submit() async {
    if (deadline == null || DateTime.now().isAfter(deadline!)) {
      setState(() {
        quote = null;
        error = const ApiFailure('报价已过期，请重新确认');
      });
      return;
    }
    if (!RegExp(r'^\d{6}$').hasMatch(password.text)) {
      setState(() => error = const ApiFailure('请输入六位支付密码'));
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    bool sent = false;
    try {
      await s.bank.call(
        'api/auth/payment-password/verify',
        method: 'POST',
        body: {'paymentPassword': password.text},
      );
      password.clear();
      if (quote!['requiresConfirm'] == true) {
        await s.bank.call(
          'api/security/verify',
          method: 'POST',
          body: {'channel': 'face'},
        );
      }
      if (DateTime.now().isAfter(deadline!)) {
        throw const ApiFailure('报价已过期，请重新确认');
      }
      final fx = quote!['fx'];
      final confirmed = {
        'version': 1,
        'fromCurrency': s.account!['currency'],
        'fee': quote!['fee'],
        'fx': fx == null
            ? null
            : {
                for (final k in [
                  'fromCurrency',
                  'toCurrency',
                  'rate',
                  'fromAmount',
                  'toAmount',
                  'spread',
                ])
                  k: fx[k],
              },
        'submitBefore': deadline!.millisecondsSinceEpoch,
      };
      sent = true;
      final value = object(
        await s.bank.call(
          'api/transfers',
          method: 'POST',
          body: {...draft!, 'confirmedQuote': confirmed},
        ),
      );
      if (mounted) setState(() => result = value);
      await s.refresh();
    } catch (e) {
      if (mounted) {
        setState(() {
          error = e;
          uncertain = sent && e is ApiFailure && e.outcomeUnknown;
        });
      }
    } finally {
      password.clear();
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final options = banks.where((b) => b['region'] == region).toList();
    return PopScope(
      canPop: !busy,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    result != null
                        ? '转账受理结果'
                        : quote != null
                        ? '确认转出'
                        : '转出',
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: busy ? null : () => Navigator.pop(context),
                  icon: const Icon(LucideIcons.x, size: 20),
                  tooltip: '关闭',
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (result != null) ...[
              Icon(
                result!['settlementStatus'] == 'success'
                    ? LucideIcons.checkCircle2
                    : LucideIcons.clock,
                size: 48,
                color: Palette.goldInk,
              ),
              const SizedBox(height: 14),
              Text(
                result!['settlementStatus'] == 'success' ? '已到账' : '银行已受理，正在处理',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 16),
              Surface(
                child: Column(
                  children: [
                    pair(
                      '金额',
                      money(
                        result!['amount'],
                        currency: s.account!['currency'],
                      ),
                    ),
                    pair(
                      '手续费',
                      money(result!['fee'], currency: s.account!['currency']),
                    ),
                    pair('交易编号', '${result!['referenceNo']}'),
                    pair('收款账号', '${result!['identifier']}'),
                    if (result!['holdUntil'] != null)
                      pair('预计处理时间', dateText(result!['holdUntil'])),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              FilledButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('完成'),
              ),
            ] else if (quote != null) ...[
              Surface(
                child: Column(
                  children: [
                    pair('收款人', '${draft!['payeeName']}'),
                    pair('收款标识', identifier.text),
                    pair(
                      '金额',
                      money(draft!['amount'], currency: s.account!['currency']),
                    ),
                    pair(
                      '手续费',
                      money(quote!['fee'], currency: s.account!['currency']),
                    ),
                    pair('预计到账', '${quote!['etaText']}'),
                    if (quote!['fx'] != null) ...[
                      pair('汇率', '${quote!['fx']['rate']}'),
                      pair(
                        '对方收款',
                        money(
                          quote!['fx']['toAmount'],
                          currency: quote!['fx']['toCurrency'],
                        ),
                      ),
                    ],
                    if (quote!['confirmReason'] != null)
                      pair('二次核验', '${quote!['confirmReason']}'),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: password,
                enabled: !busy && !uncertain,
                obscureText: true,
                keyboardType: TextInputType.number,
                maxLength: 6,
                enableSuggestions: false,
                decoration: const InputDecoration(
                  labelText: '支付密码',
                  counterText: '',
                ),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: busy || uncertain ? null : submit,
                child: Text(busy ? '银行处理中…' : '确认转出'),
              ),
              if (uncertain)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    '银行受理结果尚未确认，请关闭后查看账户明细，核对后再操作。',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if (!uncertain)
                TextButton(
                  onPressed: busy
                      ? null
                      : () => setState(() {
                          quote = null;
                          error = null;
                          password.clear();
                        }),
                  child: const Text('修改信息'),
                ),
            ] else ...[
              pair(
                '付款账户',
                '${s.account?['label']} · ${s.account?['currency']}',
              ),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'bank', label: Text('银行账户')),
                  ButtonSegment(value: 'fps', label: Text('FPS')),
                ],
                selected: {channel},
                onSelectionChanged: busy
                    ? null
                    : (v) => setState(() {
                        channel = v.first;
                        region = channel == 'fps' ? 'HK' : 'CN';
                        bankCode = null;
                      }),
              ),
              const SizedBox(height: 16),
              if (payees.isNotEmpty) ...[
                DropdownButtonFormField<String>(
                  decoration: const InputDecoration(labelText: '常用收款人'),
                  items: [
                    for (final p in payees)
                      DropdownMenuItem(
                        value: '${p['id']}',
                        child: Text(
                          '${p['name']}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: busy
                      ? null
                      : (value) {
                          final p = payees.firstWhere((p) => p['id'] == value);
                          setState(() {
                            channel = p['channel'] ?? 'bank';
                            region =
                                p['bankRegion'] ??
                                (channel == 'fps' ? 'HK' : 'CN');
                            bankCode = p['bankCode'];
                            fpsMethod = p['fpsMethod'] ?? 'mobile';
                            currency = p['payeeCurrency'] ?? 'HKD';
                            name.text = p['name'];
                            identifier.text =
                                p['accountNo'] ?? p['fpsId'] ?? '';
                          });
                        },
                ),
                const SizedBox(height: 14),
              ],
              if (channel == 'fps') ...[
                _select('标识类型', fpsMethod, const {
                  'mobile': '手机号',
                  'email': '电邮',
                  'fpsid': 'FPS ID',
                  'account': '账户号',
                }, (v) => setState(() => fpsMethod = v!)),
                const SizedBox(height: 14),
                _select('收款币种', currency, const {
                  'HKD': '港币',
                  'CNY': '人民币',
                }, (v) => setState(() => currency = v!)),
                const SizedBox(height: 14),
              ] else ...[
                _select(
                  '收款地区',
                  region,
                  const {'CN': '中国内地', 'HK': '中国香港'},
                  (v) => setState(() {
                    region = v!;
                    bankCode = null;
                  }),
                ),
                const SizedBox(height: 14),
              ],
              if (channel == 'bank' || fpsMethod == 'account') ...[
                _select('收款银行', bankCode, {
                  for (final b in options) '${b['code']}': '${b['name']}',
                }, (v) => setState(() => bankCode = v)),
                const SizedBox(height: 14),
                TextField(
                  controller: name,
                  enabled: !busy,
                  decoration: const InputDecoration(labelText: '收款人姓名'),
                ),
                const SizedBox(height: 14),
              ],
              TextField(
                controller: identifier,
                enabled: !busy,
                keyboardType: fpsMethod == 'email' && channel == 'fps'
                    ? TextInputType.emailAddress
                    : TextInputType.text,
                decoration: InputDecoration(
                  labelText: channel == 'bank' || fpsMethod == 'account'
                      ? '收款账号'
                      : '收款${{'mobile': '手机号', 'email': '电邮', 'fpsid': 'FPS ID'}[fpsMethod]}',
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: amount,
                enabled: !busy,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: InputDecoration(
                  labelText: '转出金额（${s.account?['currency']}）',
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: memo,
                enabled: !busy,
                maxLength: 100,
                decoration: const InputDecoration(labelText: '附言（选填）'),
              ),
              FilledButton(
                onPressed: busy ? null : next,
                child: Text(busy ? '核对中…' : '下一步'),
              ),
            ],
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: 14),
                child: Text(
                  '$error',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _select(
    String label,
    String? value,
    Map<String, String> values,
    ValueChanged<String?> onChange,
  ) => DropdownButtonFormField<String>(
    key: ValueKey('$label:$region:$channel:$fpsMethod:$value'),
    initialValue: values.containsKey(value) ? value : null,
    decoration: InputDecoration(labelText: label),
    isExpanded: true,
    items: values.entries
        .map(
          (e) => DropdownMenuItem(
            value: e.key,
            child: Text(e.value, overflow: TextOverflow.ellipsis),
          ),
        )
        .toList(),
    onChanged: busy ? null : onChange,
  );
}

class ExchangeSheet extends StatefulWidget {
  final BankSession session;
  const ExchangeSheet({super.key, required this.session});
  @override
  State<ExchangeSheet> createState() => _ExchangeSheetState();
}

class _ExchangeSheetState extends State<ExchangeSheet> {
  final amount = TextEditingController(), password = TextEditingController();
  String currency = 'USD';
  Json? quote;
  int? cents;
  bool busy = false, uncertain = false;
  Object? error;
  @override
  void dispose() {
    amount.dispose();
    password.clear();
    password.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.session.account?['currency'] == 'USD') currency = 'CNY';
  }

  Future<void> run() async {
    setState(() {
      busy = true;
      error = null;
    });
    bool sent = false;
    try {
      final s = widget.session;
      if (quote == null) {
        cents = parseCents(amount.text);
        final result = object(
          await s.bank.call(
            'api/exchange/quote',
            method: 'POST',
            body: {
              'fromAccountId': s.account!['id'],
              'toCurrency': currency,
              'amount': cents,
            },
          ),
        );
        if (mounted) setState(() => quote = result);
      } else {
        sent = true;
        await s.bank.call(
          'api/exchange',
          method: 'POST',
          body: {
            'quoteId': quote!['quoteId'],
            'fromAccountId': s.account!['id'],
            'toCurrency': currency,
            'amount': cents,
            'paymentPassword': password.text,
          },
        );
        await s.refresh();
        if (mounted) Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          error = e;
          uncertain = sent && e is ApiFailure && e.outcomeUnknown;
        });
      }
    } finally {
      password.clear();
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !busy,
    child: SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            '换汇',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 20),
          if (quote == null) ...[
            DropdownButtonFormField<String>(
              initialValue: currency,
              decoration: const InputDecoration(labelText: '兑换币种'),
              items: [
                for (final c in [
                  'CNY',
                  'USD',
                  'HKD',
                ].where((c) => c != widget.session.account?['currency']))
                  DropdownMenuItem(value: c, child: Text(c)),
              ],
              onChanged: busy ? null : (v) => setState(() => currency = v!),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: amount,
              enabled: !busy,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(
                labelText: '付款金额（${widget.session.account?['currency']}）',
              ),
            ),
          ] else ...[
            Surface(
              child: Column(
                children: [
                  pair('汇率', '${quote!['fx']['rate']}'),
                  pair(
                    '付款',
                    money(
                      quote!['fx']['fromAmount'],
                      currency: quote!['fx']['fromCurrency'],
                    ),
                  ),
                  pair(
                    '收款',
                    money(quote!['fx']['toAmount'], currency: currency),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: password,
              obscureText: true,
              enabled: !busy,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: '支付密码'),
            ),
          ],
          const SizedBox(height: 16),
          if (error != null) Text('$error'),
          if (uncertain) const Text('银行受理结果尚未确认，请查看账户明细后再操作。'),
          FilledButton(
            onPressed: busy || uncertain ? null : run,
            child: Text(
              busy
                  ? '处理中…'
                  : quote == null
                  ? '获取报价'
                  : '确认换汇',
            ),
          ),
          if (quote != null && !uncertain)
            TextButton(
              onPressed: busy ? null : () => setState(() => quote = null),
              child: const Text('重新报价'),
            ),
        ],
      ),
    ),
  );
}
