import 'dart:async';
import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../ui/common.dart';

class CardsPage extends StatelessWidget {
  final BankSession session;
  const CardsPage({super.key, required this.session});
  Future<void> apply(
    BuildContext context,
    Future<void> Function() reload,
  ) async {
    try {
      final products = objects(await session.bank.call('api/cards/products'));
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
              onPressed: () => apply(context, reload),
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
            color: c['theme'] == 'gold' ? Palette.gold : Palette.ink,
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
                  const Icon(LucideIcons.cat, color: Colors.white, size: 24),
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
                statusText(c['status']),
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
                ('paymentEnabled', '消费开关'),
              ])
                SwitchListTile(
                  title: Text(label),
                  value: c[field] ?? true,
                  onChanged: busy || terminal
                      ? null
                      : (v) =>
                            change('api/cards/${c['id']}/settings', {field: v}),
                ),
              const Divider(),
              ListTile(
                title: const Text('每日限额'),
                trailing: Text(money(c['dailyLimit'])),
                onTap: busy || terminal
                    ? null
                    : () async {
                        final done = await sheet(
                          context,
                          ActionForm(
                            title: '每日限额',
                            fields: [
                              FormFieldSpec(
                                'limit',
                                '金额',
                                keyboard: const TextInputType.numberWithOptions(
                                  decimal: true,
                                ),
                                initial: ((c['dailyLimit'] as num) / 100)
                                    .toStringAsFixed(2),
                              ),
                            ],
                            submit: (v) => widget.session.bank.call(
                              'api/cards/${c['id']}/settings',
                              method: 'PATCH',
                              body: {'dailyLimit': parseCents(v['limit']!)},
                            ),
                          ),
                        );
                        if (done == true) await widget.reload();
                      },
              ),
              const Divider(),
              ListTile(
                leading: const Icon(LucideIcons.eye, size: 20),
                title: const Text('查看卡片安全信息'),
                onTap: terminal
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
                onTap: terminal
                    ? null
                    : () async {
                        final done = await sheet(
                          context,
                          AddressForm(
                            session: widget.session,
                            title: '更换银行卡',
                            path: 'api/cards/${c['id']}/replace',
                          ),
                        );
                        if (done == true) {
                          await widget.reload();
                          await widget.session.refresh();
                        }
                      },
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
  final Json extra;
  const AddressForm({
    super.key,
    required this.session,
    required this.title,
    required this.path,
    this.extra = const {},
  });
  @override
  Widget build(BuildContext context) => ActionForm(
    title: title,
    fields: [
      FormFieldSpec('recipient', '收件人', initial: session.user?['name']),
      FormFieldSpec(
        'phone',
        '联系电话',
        initial: session.user?['phone'],
        keyboard: TextInputType.phone,
      ),
      const FormFieldSpec('region', '省／地区'),
      const FormFieldSpec('city', '城市'),
      const FormFieldSpec('detail', '详细地址'),
      const FormFieldSpec('postalCode', '邮政编码', optional: true),
      const FormFieldSpec(
        'password',
        '支付密码',
        secret: true,
        keyboard: TextInputType.number,
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
            k: v[k],
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
  Object? error;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed && mounted) {
      timer?.cancel();
      setState(() => secret = null);
      password.clear();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    timer?.cancel();
    secret = null;
    password.clear();
    password.dispose();
    super.dispose();
  }

  Future<void> reveal() async {
    setState(() => busy = true);
    try {
      final data = object(
        await widget.session.bank.call(
          'api/cards/${widget.id}/secrets',
          method: 'POST',
          body: {'paymentPassword': password.text},
        ),
      );
      if (!mounted) return;
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
      if (mounted) setState(() => error = e);
    } finally {
      password.clear();
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('卡片安全信息'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (secret == null)
          TextField(
            controller: password,
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
