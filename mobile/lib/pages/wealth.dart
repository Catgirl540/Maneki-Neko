import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../ui/common.dart';

const risks = {
  'R1': '低风险',
  'R2': '中低风险',
  'R3': '中风险',
  'R4': '中高风险',
  'R5': '高风险',
};

class WealthPage extends StatefulWidget {
  final BankSession session;
  const WealthPage({super.key, required this.session});
  @override
  State<WealthPage> createState() => _WealthPageState();
}

class _WealthPageState extends State<WealthPage> {
  int revision = 0;
  @override
  Widget build(BuildContext context) => RemoteView(
    key: ValueKey('${widget.session.revision}-$revision'),
    load: () async => await Future.wait([
      widget.session.bank.call('api/wealth/overview'),
      widget.session.bank.call('api/wealth/products'),
    ]),
    builder: (d, reload) {
      final overview = object(d[0]), account = object(overview['account']);
      final products = objects(d[1]), holdings = objects(overview['holdings']);
      return ListView(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
        children: [
          const Text(
            '理财',
            style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 16),
          const Text(
            '理财非存款、产品有风险、投资须谨慎',
            style: TextStyle(color: Palette.goldInk, fontSize: 12),
          ),
          const SizedBox(height: 16),
          if (account['opened'] == true) ...[
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Palette.ink,
                borderRadius: BorderRadius.circular(22),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '理财总市值',
                    style: TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    money(overview['totalValue']),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 29,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    '累计收益 ${money(overview['totalProfit'])}',
                    style: const TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                ],
              ),
            ),
            if (holdings.isNotEmpty) ...[
              const SectionTitle('我的持仓'),
              for (final h in holdings)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Surface(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          '${h['productName']}',
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                          ),
                        ),
                        pair('持有市值', money(h['marketValue'])),
                        pair('收益', money(h['profit'])),
                        OutlinedButton(
                          onPressed: h['closed'] == true
                              ? null
                              : () async {
                                  if (!await confirm(
                                    context,
                                    '确认赎回',
                                    '全部赎回 ${h['productName']}？预计金额以银行确认结果为准。',
                                  )) {
                                    return;
                                  }
                                  try {
                                    final result = object(
                                      await widget.session.bank.call(
                                        'api/wealth/redeem',
                                        method: 'POST',
                                        body: {'holdingId': h['id']},
                                      ),
                                    );
                                    await reload();
                                    await widget.session.refresh();
                                    if (context.mounted) {
                                      ScaffoldMessenger.of(
                                        context,
                                      ).showSnackBar(
                                        SnackBar(
                                          content: Text(
                                            '赎回已受理，${result['etaText']}',
                                          ),
                                        ),
                                      );
                                    }
                                  } catch (e) {
                                    if (context.mounted) {
                                      notifyError(context, e);
                                    }
                                  }
                                },
                          child: Text(h['closed'] == true ? '封闭期内' : '赎回'),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ] else
            EmptyPanel(
              '还没有理财账户',
              action: FilledButton(
                onPressed: () async {
                  await page(
                    context,
                    '开立理财账户',
                    WealthOpening(session: widget.session),
                  );
                  await reload();
                },
                child: const Text('开立理财账户'),
              ),
            ),
          SectionTitle(
            '理财产品',
            action: '风险测评',
            onTap: () async {
              await page(
                context,
                '风险测评',
                RiskAssessmentPage(session: widget.session),
              );
              await reload();
            },
          ),
          for (final p in products)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Surface(
                padding: EdgeInsets.zero,
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 10,
                  ),
                  title: Text(
                    '${p['name']}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                  subtitle: Text(
                    '${p['term']} · ${risks[p['risk']]}',
                    style: const TextStyle(fontSize: 12, color: Palette.muted),
                  ),
                  trailing: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        '${p['nav']}',
                        style: const TextStyle(
                          color: Palette.goldInk,
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const Text(
                        '单位净值',
                        style: TextStyle(fontSize: 11, color: Palette.muted),
                      ),
                    ],
                  ),
                  onTap: () async {
                    await page(
                      context,
                      '产品详情',
                      ProductDetail(
                        session: widget.session,
                        code: p['code'],
                        overview: overview,
                      ),
                    );
                    await reload();
                  },
                ),
              ),
            ),
          const SizedBox(height: 16),
        ],
      );
    },
  );
}

class ProductDetail extends StatelessWidget {
  final BankSession session;
  final String code;
  final Json overview;
  const ProductDetail({
    super.key,
    required this.session,
    required this.code,
    required this.overview,
  });
  @override
  Widget build(BuildContext context) => RemoteView(
    load: () =>
        session.bank.call('api/wealth/products/${Uri.encodeComponent(code)}'),
    builder: (d, reload) {
      final p = object(d), benchmark = object(p['benchmark']);
      return ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Text(
            '${p['name']}',
            style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          Text(
            '${p['issuer']} · ${risks[p['risk']]}',
            style: const TextStyle(color: Palette.muted),
          ),
          const SizedBox(height: 16),
          Surface(
            child: Column(
              children: [
                pair('单位净值', '${p['nav']}'),
                pair('净值日期', '${p['navDate']}'),
                pair('起购金额', money(p['minAmount'])),
                pair('递增金额', money(p['stepAmount'])),
                pair('期限', '${p['term']}'),
                pair(
                  '业绩比较基准',
                  benchmark['kind'] == 'formula'
                      ? '${benchmark['formula']}'
                      : '${((benchmark['low'] as num) * 100).toStringAsFixed(2)}%–${((benchmark['high'] as num) * 100).toStringAsFixed(2)}%',
                ),
                pair('测算依据', '${benchmark['basis']}'),
                for (final fee in [
                  ...objects(p['ongoingFees']),
                  ...objects(p['transactionFees']),
                ])
                  pair(
                    '${fee['label']}',
                    '${((fee['rate'] as num) * 100).toStringAsFixed(2)}%',
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            '业绩比较基准不是预期收益率，不代表未来表现和实际收益，不构成收益承诺',
            style: TextStyle(color: Palette.muted, fontSize: 12, height: 1.6),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () async {
              final a = object(overview['account']);
              final r = object(overview['risk']);
              if (a['opened'] != true) {
                notifyError(context, const ApiFailure('请先开立理财账户'));
                return;
              }
              if (r['done'] != true || r['expired'] == true) {
                notifyError(context, const ApiFailure('请先完成有效的风险测评'));
                return;
              }
              if (int.parse('${r['level']}'.substring(1)) <
                  int.parse('${p['risk']}'.substring(1))) {
                notifyError(context, const ApiFailure('产品风险超过当前风险承受能力'));
                return;
              }
              await sheet(
                context,
                ActionForm(
                  title: '申购${p['name']}',
                  introduction: const Text(
                    '请完整抄录：$riskAcknowledgement',
                    style: TextStyle(height: 1.6),
                  ),
                  fields: const [
                    FormFieldSpec(
                      'amount',
                      '申购金额',
                      keyboard: TextInputType.numberWithOptions(decimal: true),
                    ),
                    FormFieldSpec('ack', '风险确认语句'),
                    FormFieldSpec(
                      'password',
                      '支付密码',
                      secret: true,
                      keyboard: TextInputType.number,
                    ),
                  ],
                  submit: (v) async {
                    if (v['ack'] != riskAcknowledgement) {
                      throw const ApiFailure('请完整抄录风险确认语句');
                    }
                    final cents = parseCents(v['amount']!);
                    if (cents < (p['minAmount'] as num) ||
                        (cents - (p['minAmount'] as num)) %
                                (p['stepAmount'] as num) !=
                            0) {
                      throw const ApiFailure('金额不符合产品起购与递增要求');
                    }
                    final value = await session.bank.call(
                      'api/wealth/subscribe',
                      method: 'POST',
                      body: {
                        'productCode': code,
                        'amount': cents,
                        'riskAcknowledgement': v['ack'],
                        'paymentPassword': v['password'],
                      },
                    );
                    await session.refresh();
                    return value;
                  },
                  success: (r) => '申购已确认，份额 ${r['shares']}',
                ),
              );
            },
            child: const Text('申购'),
          ),
        ],
      );
    },
  );
}

class RiskAssessmentPage extends StatefulWidget {
  final BankSession session;
  const RiskAssessmentPage({super.key, required this.session});
  @override
  State<RiskAssessmentPage> createState() => _RiskAssessmentPageState();
}

class _RiskAssessmentPageState extends State<RiskAssessmentPage> {
  final answers = <int, int>{};
  bool busy = false;
  Object? error;
  @override
  Widget build(BuildContext context) => RemoteView(
    load: () => widget.session.bank.call('api/wealth/risk/questions'),
    builder: (d, reload) {
      final questions = objects(d);
      return ListView(
        padding: const EdgeInsets.all(18),
        children: [
          for (var i = 0; i < questions.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Surface(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${i + 1}. ${questions[i]['question']}',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 10),
                    for (
                      var j = 0;
                      j < (questions[i]['options'] as List).length;
                      j++
                    )
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('${questions[i]['options'][j]['label']}'),
                        value: answers[i] == j,
                        onChanged: busy
                            ? null
                            : (v) => setState(() => answers[i] = j),
                        controlAffinity: ListTileControlAffinity.leading,
                      ),
                  ],
                ),
              ),
            ),
          if (error != null) Text('$error'),
          FilledButton(
            onPressed: busy || answers.length != questions.length
                ? null
                : () async {
                    setState(() => busy = true);
                    try {
                      final result = object(
                        await widget.session.bank.call(
                          'api/wealth/risk/assess',
                          method: 'POST',
                          body: {
                            'answers': [
                              for (var i = 0; i < questions.length; i++)
                                answers[i],
                            ],
                          },
                        ),
                      );
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('测评已完成：${result['level']}')),
                        );
                        Navigator.pop(context, true);
                      }
                    } catch (e) {
                      if (mounted) setState(() => error = e);
                    } finally {
                      if (mounted) setState(() => busy = false);
                    }
                  },
            child: Text(busy ? '提交中…' : '提交测评'),
          ),
        ],
      );
    },
  );
}

class WealthOpening extends StatefulWidget {
  final BankSession session;
  const WealthOpening({super.key, required this.session});
  @override
  State<WealthOpening> createState() => _WealthOpeningState();
}

class _WealthOpeningState extends State<WealthOpening> {
  final sms = TextEditingController();
  String? ticket;
  bool signed = false, busy = false;
  Object? error;
  @override
  void dispose() {
    sms.dispose();
    super.dispose();
  }

  Future<void> run(Future<void> Function() work) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await work();
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
      Surface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${widget.session.user?['name']}',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              '${widget.session.user?['phone']}',
              style: const TextStyle(color: Palette.muted),
            ),
          ],
        ),
      ),
      const SectionTitle('1. 风险承受能力评估'),
      OutlinedButton(
        onPressed: busy
            ? null
            : () => page(
                context,
                '风险测评',
                RiskAssessmentPage(session: widget.session),
              ),
        child: const Text('开始风险测评'),
      ),
      const SectionTitle('2. 确认本人操作'),
      Row(
        children: [
          Expanded(
            child: TextField(
              controller: sms,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: '短信验证码'),
            ),
          ),
          TextButton(
            onPressed: busy
                ? null
                : () => run(() async {
                    final result = object(
                      await widget.session.bank.call(
                        'api/auth/sms-code',
                        method: 'POST',
                        body: {'phone': widget.session.user!['phone']},
                      ),
                    );
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            result['demoCode'] != null
                                ? '测试服务验证码：${result['demoCode']}'
                                : '验证码已发送',
                          ),
                        ),
                      );
                    }
                  }),
            child: const Text('获取验证码'),
          ),
        ],
      ),
      const SizedBox(height: 14),
      OutlinedButton.icon(
        onPressed: busy
            ? null
            : () => run(() async {
                final result = object(
                  await widget.session.bank.call(
                    'api/security/verify',
                    method: 'POST',
                    body: {'channel': 'face'},
                  ),
                );
                if (result['ticket'] is! String) {
                  throw const ApiFailure('身份核验未完成');
                }
                if (mounted) setState(() => ticket = result['ticket']);
              }),
        icon: Icon(
          ticket == null ? LucideIcons.scanFace : LucideIcons.checkCircle2,
        ),
        label: Text(ticket == null ? '人脸核验' : '核验已完成'),
      ),
      const SectionTitle('3. 签署投资协议'),
      CheckboxListTile(
        value: signed,
        onChanged: busy ? null : (v) => setState(() => signed = v ?? false),
        contentPadding: EdgeInsets.zero,
        title: const Text(
          investmentAgreement,
          style: TextStyle(fontSize: 13, height: 1.6),
        ),
        controlAffinity: ListTileControlAffinity.leading,
      ),
      if (error != null)
        Text(
          '$error',
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      const SizedBox(height: 18),
      FilledButton(
        onPressed:
            busy || ticket == null || !signed || widget.session.account == null
            ? null
            : () => run(() async {
                await widget.session.bank.call(
                  'api/wealth/account/open',
                  method: 'POST',
                  body: {
                    'smsCode': sms.text.trim(),
                    'faceTicket': ticket,
                    'settlementAccountId': widget.session.account!['id'],
                    'agreement': investmentAgreement,
                  },
                );
                if (context.mounted) Navigator.pop(context, true);
              }),
        child: Text(busy ? '提交中…' : '确认开户'),
      ),
    ],
  );
}
