import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../ui/common.dart';
import '../ui/cat_glyph.dart';

class CardsPage extends StatefulWidget {
  final BankSession session;
  const CardsPage({super.key, required this.session});
  @override
  State<CardsPage> createState() => _CardsPageState();
}

class _CardsPageState extends State<CardsPage> {
  bool opening = false;
  BankSession get session => widget.session;
  Future<void> apply(
    BuildContext context,
    Future<void> Function() reload,
  ) async {
    if (opening) return;
    setState(() => opening = true);
    try {
      final products = objects(await session.bank.call('api/cards/products'));
      if (products.isEmpty) throw const ApiFailure('暂无可申请的银行卡产品');
      for (final product in products) {
        cardFee(product);
      }
      if (!context.mounted) return;
      await sheet(
        context,
        SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                '申请新卡',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 16),
              for (final p in products)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Surface(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          '${p['name']}',
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        pair(
                          '制卡与配送',
                          money(
                            (p['issuingFee'] as num) +
                                (p['deliveryFee'] as num),
                          ),
                        ),
                        pair('预计配送', '${p['deliveryDays']} 个工作日'),
                        for (final perk in p['perks'] as List)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 5),
                            child: Text(
                              '$perk',
                              style: const TextStyle(
                                fontSize: 13,
                                color: Palette.muted,
                              ),
                            ),
                          ),
                        const SizedBox(height: 10),
                        FilledButton(
                          onPressed: () async {
                            final result = await sheet(
                              context,
                              AddressForm(
                                session: session,
                                title: '申请${p['name']}',
                                path: 'api/cards/open',
                                product: p,
                                extra: {'productCode': p['code']},
                              ),
                            );
                            if (result == true) {
                              await reload();
                              await session.refresh();
                              if (context.mounted) Navigator.pop(context);
                            }
                          },
                          child: const Text('申请'),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
    } catch (e) {
      if (context.mounted) notifyError(context, e);
    } finally {
      if (mounted) setState(() => opening = false);
    }
  }

  @override
  Widget build(BuildContext context) => RemoteView(
    load: () => session.bank.call('api/cards'),
    builder: (d, reload) {
      final cards = objects(d);
      return ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              onPressed: opening ? null : () => apply(context, reload),
              icon: const Icon(LucideIcons.creditCard, size: 18),
              label: const Text('申请新卡'),
            ),
          ),
          const SizedBox(height: 16),
          if (cards.isEmpty) const EmptyPanel('还没有银行卡'),
          for (final card in cards)
            Padding(
              padding: const EdgeInsets.only(bottom: 18),
              child: CardControls(
                key: ValueKey(card['id']),
                session: session,
                card: card,
                reload: reload,
              ),
            ),
        ],
      );
    },
  );
}

class CardControls extends StatefulWidget {
  final BankSession session;
  final Json card;
  final Future<void> Function() reload;
  const CardControls({
    super.key,
    required this.session,
    required this.card,
    required this.reload,
  });
  @override
  State<CardControls> createState() => _CardControlsState();
}

class _CardControlsState extends State<CardControls> {
  bool busy = false;
  Future<void> change(String path, Json body, {String method = 'PATCH'}) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await widget.session.bank.call(path, method: method, body: body);
      await widget.reload();
    } catch (e) {
      if (mounted) notifyError(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> replace() async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final products = objects(
        await widget.session.bank.call('api/cards/products'),
      );
      final product = products
          .where((p) => p['network'] == widget.card['network'])
          .firstOrNull;
      if (product == null) throw const ApiFailure('换卡产品费用暂不可用，请稍后重试');
      cardFee(product);
      if (!mounted) return;
      final done = await sheet(
        context,
        AddressForm(
          session: widget.session,
          title: '更换银行卡',
          path: 'api/cards/${widget.card['id']}/replace',
          product: product,
        ),
      );
      if (done == true) {
        await widget.reload();
        await widget.session.refresh();
      }
    } catch (e) {
      if (mounted) notifyError(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.card;
    final terminal = !['active', 'locked'].contains(c['status']);
    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            color: ['gold', 'champagne'].contains(c['theme'])
                ? Palette.gold
                : Palette.ink,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${c['productName']}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const CatGlyph(color: Colors.white, size: 32),
                ],
              ),
              const SizedBox(height: 30),
              Text(
                '••••  ••••  ••••  ${c['last4']}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 23,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${c['cardholder']}',
                      style: const TextStyle(color: Colors.white),
                    ),
                  ),
                  Text(
                    '${c['network']}'.toUpperCase(),
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                c['status'] == 'pending' ? '待激活' : statusText(c['status']),
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Surface(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              SwitchListTile(
                title: const Text('锁定银行卡'),
                value: c['status'] == 'locked',
                onChanged: busy || terminal
                    ? null
                    : (v) => change('api/cards/${c['id']}/lock', {
                        'locked': v,
                      }, method: 'POST'),
              ),
              const Divider(),
              for (final (field, label) in [
                ('onlinePayment', '网上支付'),
                ('overseasPayment', '境外交易'),
              ])
                SwitchListTile(
                  title: Text(label),
                  value: c[field] == true,
                  onChanged: busy || c['status'] != 'active'
                      ? null
                      : (v) =>
                            change('api/cards/${c['id']}/settings', {field: v}),
                ),
              const Divider(),
              ListTile(
                title: const Text('每日限额'),
                trailing: Text(money(c['dailyLimit'])),
                onTap: busy || c['status'] != 'active'
                    ? null
                    : () async {
                        final selected = await sheet<int>(
                          context,
                          Padding(
                            padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Text(
                                  '每日限额',
                                  style: TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                for (final limit in cardDailyLimits)
                                  ListTile(
                                    title: Text(money(limit)),
                                    trailing: limit == c['dailyLimit']
                                        ? const Icon(LucideIcons.check)
                                        : null,
                                    onTap: () => Navigator.pop(context, limit),
                                  ),
                              ],
                            ),
                          ),
                        );
                        if (selected != null && mounted) {
                          await change('api/cards/${c['id']}/settings', {
                            'dailyLimit': selected,
                          });
                        }
                      },
              ),
              const Divider(),
              ListTile(
                leading: const Icon(LucideIcons.eye, size: 20),
                title: const Text('查看卡片安全信息'),
                onTap: busy || terminal
                    ? null
                    : () => showDialog(
                        context: context,
                        builder: (_) =>
                            SecretDialog(session: widget.session, id: c['id']),
                      ),
              ),
              const Divider(),
              ListTile(
                leading: const Icon(LucideIcons.refreshCw, size: 20),
                title: const Text('更换银行卡'),
                onTap:
                    busy ||
                        !['active', 'locked', 'pending'].contains(c['status'])
                    ? null
                    : replace,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class AddressForm extends StatelessWidget {
  final BankSession session;
  final String title, path;
  final Json extra, product;
  const AddressForm({
    super.key,
    required this.session,
    required this.title,
    required this.path,
    required this.product,
    this.extra = const {},
  });
  @override
  Widget build(BuildContext context) => ActionForm(
    title: title,
    submitLabel:
        '支付 ${money(cardFee(product))} 并${path.endsWith('/replace') ? '换卡' : '申请'}',
    introduction: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        pair('制卡费', money(product['issuingFee'])),
        pair('寄送费', money(product['deliveryFee'])),
        const Text(
          '费用从储蓄账户扣除，实体卡寄送至下方地址。',
          style: TextStyle(fontSize: 13, color: Palette.muted),
        ),
        if (path.endsWith('/replace'))
          const Padding(
            padding: EdgeInsets.only(top: 10),
            child: Text('换卡后旧卡立即失效、卡号变更；已绑定的自动扣款需重新签约。'),
          ),
      ],
    ),
    fields: [
      FormFieldSpec('recipient', '收件人', initial: session.user?['name']),
      FormFieldSpec(
        'phone',
        '联系电话',
        initial: session.user?['phone'],
        keyboard: TextInputType.phone,
        validator: (v) =>
            RegExp(
              r'^1[3-9][0-9]{9}$',
            ).hasMatch(v.replaceAll(RegExp(r'\s'), ''))
            ? null
            : '请输入 11 位手机号',
      ),
      const FormFieldSpec('region', '省／地区'),
      const FormFieldSpec('city', '城市'),
      FormFieldSpec(
        'detail',
        '详细地址',
        validator: (v) => v.trim().length >= 5 ? null : '详细地址至少 5 个字',
      ),
      FormFieldSpec(
        'postalCode',
        '邮政编码',
        optional: true,
        validator: (v) =>
            v.trim().isEmpty || RegExp(r'^[0-9]{6}$').hasMatch(v.trim())
            ? null
            : '邮政编码为 6 位数字',
      ),
      FormFieldSpec(
        'password',
        '支付密码',
        secret: true,
        keyboard: TextInputType.number,
        validator: (v) => validCardPassword(v) ? null : '请输入 6 位数字支付密码',
      ),
    ],
    submit: (v) => session.bank.call(
      path,
      method: 'POST',
      body: {
        ...extra,
        'address': {
          for (final k in [
            'recipient',
            'phone',
            'region',
            'city',
            'detail',
            'postalCode',
          ])
            k: k == 'phone' ? v[k]!.replaceAll(RegExp(r'\s'), '') : v[k],
        },
        'paymentPassword': v['password'],
      },
    ),
  );
}

class SecretDialog extends StatefulWidget {
  final BankSession session;
  final String id;
  const SecretDialog({super.key, required this.session, required this.id});
  @override
  State<SecretDialog> createState() => _SecretDialogState();
}

class _SecretDialogState extends State<SecretDialog>
    with WidgetsBindingObserver {
  final password = TextEditingController();
  Json? secret;
  Timer? timer;
  bool busy = false;
  int generation = 0;
  Object? error;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(protectCard(true));
  }

  Future<void> protectCard(bool enabled) async {
    try {
      await const MethodChannel(
        'luckycat/files',
      ).invokeMethod<void>('protectCard', enabled);
    } on MissingPluginException {
      /* Widget tests and platforms without the Android host. */
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed && mounted) {
      generation++;
      timer?.cancel();
      setState(() => secret = null);
      password.clear();
    }
  }

  @override
  void dispose() {
    generation++;
    unawaited(protectCard(false));
    WidgetsBinding.instance.removeObserver(this);
    timer?.cancel();
    secret = null;
    password.clear();
    password.dispose();
    super.dispose();
  }

  Future<void> reveal() async {
    if (busy) return;
    if (!validCardPassword(password.text)) {
      setState(() => error = '请输入 6 位数字支付密码');
      return;
    }
    final requestGeneration = ++generation;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final data = object(
        await widget.session.bank.call(
          'api/cards/${widget.id}/secrets',
          method: 'POST',
          body: {'paymentPassword': password.text},
        ),
      );
      if (!mounted || requestGeneration != generation) return;
      final seconds = data['revealSeconds'];
      if (data['pan'] is! String ||
          (data['pan'] as String).isEmpty ||
          seconds is! num ||
          seconds <= 0) {
        throw const ApiFailure('卡信息暂不可用，请重试');
      }
      setState(() {
        secret = data;
        error = null;
      });
      timer = Timer(
        Duration(seconds: (data['revealSeconds'] as num).toInt().clamp(1, 60)),
        () {
          if (mounted) setState(() => secret = null);
        },
      );
    } catch (e) {
      if (mounted && requestGeneration == generation) setState(() => error = e);
    } finally {
      if (mounted) {
        password.clear();
        setState(() => busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('卡片安全信息'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (secret == null)
            TextField(
              controller: password,
              enabled: !busy,
              enableSuggestions: false,
              autocorrect: false,
              obscureText: true,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: '支付密码'),
            )
          else ...[
            pair('卡号', '${secret!['pan']}'),
            pair('有效期', '${secret!['expiry']}'),
            pair('安全码', '${secret!['cvv']}'),
          ],
          if (error != null) Text('$error'),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('关闭'),
      ),
      if (secret == null)
        FilledButton(
          onPressed: busy ? null : reveal,
          child: Text(busy ? '验证中…' : '验证并查看'),
        ),
    ],
  );
}

const cardDailyLimits = [200000, 500000, 1000000, 5000000];
bool validCardPassword(String value) => RegExp(r'^[0-9]{6}$').hasMatch(value);
int cardFee(Json product) {
  final issuing = product['issuingFee'], delivery = product['deliveryFee'];
  if (issuing is! int || delivery is! int || issuing < 0 || delivery < 0) {
    throw const ApiFailure('卡产品费用暂不可用，请稍后重试');
  }
  return issuing + delivery;
}
