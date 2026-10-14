import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/updates.dart';
import '../ui/common.dart';
import 'update.dart';

class ProfilePage extends StatelessWidget {
  final BankSession session;
  final VoidCallback onHelp;
  final AppUpdater updater;
  const ProfilePage({
    super.key,
    required this.session,
    required this.onHelp,
    required this.updater,
  });
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
    children: [
      const Text(
        '我的',
        style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 24),
      Row(
        children: [
          CircleAvatar(
            radius: 28,
            backgroundColor: Palette.goldSoft,
            child: Text(
              '${session.user?['avatarInitial'] ?? ''}',
              style: const TextStyle(
                color: Palette.goldInk,
                fontSize: 23,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${session.user?['name'] ?? ''}',
                style: const TextStyle(
                  fontSize: 21,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                _phone('${session.user?['phone']}'),
                style: const TextStyle(color: Palette.muted),
              ),
            ],
          ),
        ],
      ),
      const SizedBox(height: 26),
      Surface(
        padding: EdgeInsets.zero,
        child: Column(
          children: [
            _row(
              '账户与安全',
              LucideIcons.shieldCheck,
              () => page(context, '账户与安全', SecurityPage(session: session)),
            ),
            const Divider(),
            _row(
              '支付设置',
              LucideIcons.settings2,
              () => page(
                context,
                '支付设置',
                SecurityPage(session: session, rulesOnly: true),
              ),
            ),
            const Divider(),
            _row(
              '安全记录',
              LucideIcons.bell,
              () => page(
                context,
                '安全记录',
                SecurityPage(session: session, logsOnly: true),
              ),
            ),
            const Divider(),
            _row('帮助与客服', LucideIcons.messageCircle, onHelp),
            const Divider(),
            AnimatedBuilder(
              animation: updater,
              builder: (context, _) => _row(
                updater.hasUpdate && updater.phase != UpdatePhase.incompatible
                    ? '检查更新 · 有新版本'
                    : '检查更新',
                LucideIcons.refreshCw,
                () => page(context, '应用更新', UpdatePage(updater: updater)),
              ),
            ),
            const Divider(),
            _row(
              '关于招财猫银行',
              LucideIcons.cat,
              () => showAboutDialog(
                context: context,
                applicationName: '招财猫银行',
                applicationVersion: updater.installed?.versionName,
                applicationIcon: const CatMark(),
                children: [const Text('招财猫银行客户端。账户与交易状态由所连接的银行服务提供。')],
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: 24),
      OutlinedButton(
        onPressed: () async {
          if (!await confirm(context, '退出登录', '确认退出当前账户？')) return;
          try {
            await session.logout();
          } catch (e) {
            if (context.mounted) notifyError(context, e);
          }
        },
        child: const Text('退出登录'),
      ),
    ],
  );
  Widget _row(String title, IconData icon, VoidCallback tap) => ListTile(
    leading: Icon(icon, size: 21, color: Palette.muted),
    title: Text(title, style: const TextStyle(fontSize: 15)),
    trailing: const Icon(
      LucideIcons.chevronRight,
      size: 18,
      color: Palette.muted,
    ),
    onTap: tap,
  );
  String _phone(String value) => value.length > 7
      ? '${value.substring(0, 3)} **** ${value.substring(value.length - 4)}'
      : value;
}

class SecurityPage extends StatelessWidget {
  final BankSession session;
  final bool logsOnly, rulesOnly;
  const SecurityPage({
    super.key,
    required this.session,
    this.logsOnly = false,
    this.rulesOnly = false,
  });
  @override
  Widget build(BuildContext context) => RemoteView(
    load: () => session.bank.call('api/security/overview'),
    builder: (d, reload) {
      final data = object(d);
      return ListView(
        padding: const EdgeInsets.all(18),
        children: [
          if (!logsOnly && !rulesOnly) ...[
            Surface(
              child: Row(
                children: [
                  const Icon(
                    LucideIcons.shieldCheck,
                    size: 42,
                    color: Palette.goldInk,
                  ),
                  const SizedBox(width: 16),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${data['level']}',
                        style: const TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        '安全评分 ${data['score']}',
                        style: const TextStyle(color: Palette.muted),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SectionTitle('登录设置'),
            Surface(
              padding: EdgeInsets.zero,
              child: Column(
                children: [
                  ListTile(
                    title: const Text('修改登录密码'),
                    trailing: const Icon(LucideIcons.chevronRight, size: 18),
                    onTap: () => sheet(
                      context,
                      ActionForm(
                        title: '修改登录密码',
                        fields: const [
                          FormFieldSpec('old', '当前登录密码', secret: true),
                          FormFieldSpec('next', '新登录密码', secret: true),
                          FormFieldSpec('repeat', '确认新密码', secret: true),
                        ],
                        submit: (v) {
                          if (v['next'] != v['repeat']) {
                            throw const ApiFailure('两次新密码不一致');
                          }
                          return session.bank.call(
                            'api/security/password',
                            method: 'POST',
                            body: {
                              'oldPassword': v['old'],
                              'newPassword': v['next'],
                            },
                          );
                        },
                      ),
                    ),
                  ),
                  const Divider(),
                  ListTile(
                    title: const Text('更换手机号'),
                    trailing: const Icon(LucideIcons.chevronRight, size: 18),
                    onTap: () => page(
                      context,
                      '更换手机号',
                      ChangePhonePage(session: session),
                    ),
                  ),
                ],
              ),
            ),
            const SectionTitle('登录设备'),
            Surface(
              child: Column(
                children: [
                  for (final device in objects(data['devices']))
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(LucideIcons.smartphone),
                      title: Text(
                        '${device['name']}${device['current'] == true ? ' · 当前设备' : ''}',
                      ),
                      subtitle: Text(
                        '${device['location']} · ${dateText(device['lastActiveAt'])}',
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                ],
              ),
            ),
          ],
          if (rulesOnly) ...[
            const SectionTitle('安全规则'),
            Surface(
              padding: EdgeInsets.zero,
              child: Column(
                children: [
                  for (final rule in objects(data['riskRules']))
                    _RuleSwitch(session: session, rule: rule, reload: reload),
                ],
              ),
            ),
          ],
          if (logsOnly) ...[
            const SectionTitle('安全记录'),
            if ((data['logs'] as List).isEmpty)
              const EmptyPanel('暂无安全记录')
            else
              Surface(
                child: Column(
                  children: [
                    for (final log in objects(data['logs']))
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('${log['action']}'),
                        subtitle: Text(
                          '${dateText(log['createdAt'])}\n${log['detail']}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: Palette.muted,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ],
      );
    },
  );
}

class _RuleSwitch extends StatefulWidget {
  final BankSession session;
  final Json rule;
  final Future<void> Function() reload;
  const _RuleSwitch({
    required this.session,
    required this.rule,
    required this.reload,
  });
  @override
  State<_RuleSwitch> createState() => _RuleSwitchState();
}

class _RuleSwitchState extends State<_RuleSwitch> {
  bool busy = false;
  @override
  Widget build(BuildContext context) => SwitchListTile(
    title: Text('${widget.rule['label']}'),
    subtitle: Text(
      '${widget.rule['description']}',
      style: const TextStyle(fontSize: 12),
    ),
    value: widget.rule['enabled'] == true,
    onChanged: busy
        ? null
        : (v) async {
            setState(() => busy = true);
            try {
              await widget.session.bank.call(
                'api/security/rules/${widget.rule['id']}',
                method: 'PATCH',
                body: {'enabled': v},
              );
              await widget.reload();
            } catch (e) {
              if (context.mounted) notifyError(context, e);
            } finally {
              if (mounted) setState(() => busy = false);
            }
          },
  );
}

class ChangePhonePage extends StatefulWidget {
  final BankSession session;
  const ChangePhonePage({super.key, required this.session});
  @override
  State<ChangePhonePage> createState() => _ChangePhonePageState();
}

class _ChangePhonePageState extends State<ChangePhonePage> {
  final phone = TextEditingController(), sms = TextEditingController();
  String? ticket;
  bool busy = false;
  Object? error;
  @override
  void dispose() {
    phone.dispose();
    sms.dispose();
    super.dispose();
  }

  Future<void> run(Future<void> Function() fn) async {
    setState(() => busy = true);
    try {
      await fn();
    } catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(18),
    children: [
      TextField(
        controller: phone,
        enabled: !busy,
        onChanged: (_) => setState(() {
          ticket = null;
          sms.clear();
        }),
        keyboardType: TextInputType.phone,
        decoration: const InputDecoration(labelText: '新手机号'),
      ),
      const SizedBox(height: 16),
      TextField(
        controller: sms,
        keyboardType: TextInputType.number,
        enabled: !busy,
        decoration: InputDecoration(
          labelText: '新手机号验证码',
          suffixIcon: TextButton(
            onPressed: busy
                ? null
                : () => run(() async {
                    final data = object(
                      await widget.session.bank.call(
                        'api/auth/sms-code',
                        method: 'POST',
                        body: {'phone': phone.text.trim()},
                      ),
                    );
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            data['demoCode'] != null
                                ? '测试服务验证码：${data['demoCode']}'
                                : '验证码已发送',
                          ),
                        ),
                      );
                    }
                  }),
            child: const Text('获取验证码'),
          ),
        ),
      ),
      const SizedBox(height: 16),
      OutlinedButton(
        onPressed: busy
            ? null
            : () => run(() async {
                final data = object(
                  await widget.session.bank.call(
                    'api/security/verify',
                    method: 'POST',
                    body: {'channel': 'face'},
                  ),
                );
                if (mounted) setState(() => ticket = data['ticket']);
              }),
        child: Text(ticket == null ? '开始人脸核验' : '核验已完成'),
      ),
      const SizedBox(height: 16),
      if (error != null) Text('$error'),
      FilledButton(
        onPressed: busy || ticket == null
            ? null
            : () => run(() async {
                await widget.session.bank.call(
                  'api/auth/phone',
                  method: 'PATCH',
                  body: {
                    'newPhone': phone.text.trim(),
                    'smsCode': sms.text.trim(),
                    'faceTicket': ticket,
                  },
                );
                widget.session.user = object(
                  await widget.session.bank.call('api/auth/profile'),
                );
                await widget.session.refresh();
                if (context.mounted) Navigator.pop(context);
              }),
        child: Text(busy ? '提交中…' : '确认更换'),
      ),
    ],
  );
}

class AutoDebitsPage extends StatelessWidget {
  final BankSession session;
  const AutoDebitsPage({super.key, required this.session});
  @override
  Widget build(BuildContext context) => RemoteView(
    load: () => session.bank.call('api/autodebits'),
    builder: (d, reload) {
      final rows = objects(d);
      return ListView(
        padding: const EdgeInsets.all(18),
        children: [
          if (rows.isEmpty) const EmptyPanel('暂无自动扣款'),
          for (final item in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Surface(
                padding: EdgeInsets.zero,
                child: _DebitSwitch(
                  session: session,
                  item: item,
                  reload: reload,
                ),
              ),
            ),
        ],
      );
    },
  );
}

class _DebitSwitch extends StatefulWidget {
  final BankSession session;
  final Json item;
  final Future<void> Function() reload;
  const _DebitSwitch({
    required this.session,
    required this.item,
    required this.reload,
  });
  @override
  State<_DebitSwitch> createState() => _DebitSwitchState();
}

class _DebitSwitchState extends State<_DebitSwitch> {
  bool busy = false;
  @override
  Widget build(BuildContext context) => SwitchListTile(
    title: Text('${widget.item['merchant']}'),
    subtitle: Text(
      '${money(widget.item['amount'])} · ${widget.item['cycle']}\n下次扣款 ${dateText(widget.item['nextRunAt'])}',
    ),
    value: widget.item['enabled'] == true,
    onChanged: busy
        ? null
        : (v) async {
            setState(() => busy = true);
            try {
              await widget.session.bank.call(
                'api/autodebits/${widget.item['id']}',
                method: 'PATCH',
                body: {'enabled': v},
              );
              await widget.reload();
            } catch (e) {
              if (context.mounted) notifyError(context, e);
            } finally {
              if (mounted) setState(() => busy = false);
            }
          },
  );
}

class AnalysisPage extends StatelessWidget {
  final BankSession session;
  const AnalysisPage({super.key, required this.session});
  @override
  Widget build(BuildContext context) => RemoteView(
    load: () => Future.wait([
      session.bank.call('api/analysis/spending'),
      session.bank.call('api/analysis/cashflow', query: {'days': '30'}),
    ]),
    builder: (d, reload) {
      final spend = object(d[0]), cash = object(d[1]);
      return ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Text(
            '${spend['month']} 消费',
            style: const TextStyle(color: Palette.muted),
          ),
          const SizedBox(height: 6),
          Text(
            money(spend['total']),
            style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w700),
          ),
          const SectionTitle('消费分类'),
          Surface(
            child: Column(
              children: [
                for (final category in objects(spend['categories']))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 15),
                    child: Column(
                      children: [
                        pair('${category['label']}', money(category['amount'])),
                        LinearProgressIndicator(
                          value: (category['ratio'] as num).toDouble().clamp(
                            0,
                            1,
                          ),
                          backgroundColor: Palette.goldSoft,
                          color: Palette.gold,
                          minHeight: 6,
                          borderRadius: BorderRadius.circular(3),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SectionTitle('近 30 天现金流'),
          Surface(
            child: Column(
              children: [
                pair('收入', money(cash['totalIncome'])),
                pair('支出', money(cash['totalExpense'])),
                const Divider(),
                for (final point in objects(
                  cash['points'],
                ).where((p) => p['income'] != 0 || p['expense'] != 0))
                  pair(
                    '${point['date']}',
                    '+ ${money(point['income'])} / − ${money(point['expense'])}',
                  ),
              ],
            ),
          ),
          const SectionTitle('消费趋势'),
          Surface(
            child: Column(
              children: [
                for (final point in objects(spend['trend']))
                  pair('${point['month']}', money(point['amount'])),
              ],
            ),
          ),
        ],
      );
    },
  );
}
