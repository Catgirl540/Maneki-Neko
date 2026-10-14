import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/files.dart';
import '../ui/common.dart';
import 'transfer.dart';
import 'cards.dart';
import 'profile.dart';

class AccountPage extends StatefulWidget {
  final BankSession session;
  final VoidCallback onProfile;
  const AccountPage({
    super.key,
    required this.session,
    required this.onProfile,
  });
  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> {
  bool reveal = true;
  Future<void> receiving() async {
    await sheet(context, ReceivingSheet(session: widget.session));
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.session,
    builder: (context, _) {
      final s = widget.session;
      final a = s.account;
      return RefreshIndicator(
        onRefresh: s.refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
          children: [
            Row(
              children: [
                const CatMark(),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    '${DateTime.now().hour < 12
                        ? '早上好'
                        : DateTime.now().hour < 18
                        ? '下午好'
                        : '晚上好'}，${s.user?['name'] ?? ''}',
                    style: const TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: widget.onProfile,
                  icon: const Icon(LucideIcons.userCircle2),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (s.error != null)
              ErrorPanel(s.error!, retry: s.refresh)
            else if (a == null) ...[
              if (s.loading)
                const Center(child: CircularProgressIndicator())
              else
                const EmptyPanel('暂无资金账户'),
            ] else ...[
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Palette.ink,
                  borderRadius: BorderRadius.circular(22),
                  boxShadow: [
                    BoxShadow(
                      color: Palette.ink.withValues(alpha: .15),
                      blurRadius: 20,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                child: Stack(
                  children: [
                    Positioned(
                      right: -18,
                      bottom: -25,
                      child: Icon(
                        LucideIcons.cat,
                        size: 144,
                        color: Palette.gold.withValues(alpha: .13),
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '账户余额 · ${a['currency']}',
                          style: const TextStyle(
                            color: Color(0xffCDC9BE),
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  reveal
                                      ? money(
                                          a['balance'],
                                          currency: a['currency'],
                                        )
                                      : '••••••••',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 32,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                            IconButton(
                              onPressed: () => setState(() => reveal = !reveal),
                              icon: Icon(
                                reveal ? LucideIcons.eye : LucideIcons.eyeOff,
                                color: Colors.white,
                                size: 20,
                              ),
                              tooltip: reveal ? '隐藏余额' : '显示余额',
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        const Divider(color: Colors.white12),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                '${a['label']} · ${_tail('${a['accountNo']}')}',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                            const Text(
                              '资金账户',
                              style: TextStyle(
                                color: Palette.gold,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              if (s.accounts.length > 1)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Wrap(
                    spacing: 8,
                    children: [
                      for (final account in s.accounts)
                        ChoiceChip(
                          label: Text(
                            '${account['currency']} · ${_tail('${account['accountNo']}')}',
                          ),
                          selected: account['id'] == a['id'],
                          onSelected: s.loading
                              ? null
                              : (_) {
                                  s.selectedId = account['id'];
                                  s.refresh();
                                },
                        ),
                    ],
                  ),
                ),
              const SizedBox(height: 14),
              Surface(
                padding: const EdgeInsets.symmetric(
                  horizontal: 6,
                  vertical: 10,
                ),
                child: Row(
                  children: [
                    _action(
                      '转账',
                      LucideIcons.arrowLeftRight,
                      () => sheet(context, TransferChooser(session: s)),
                      gold: true,
                    ),
                    _action('收款', LucideIcons.arrowDownToLine, receiving),
                    _action(
                      '自动扣款',
                      LucideIcons.receipt,
                      () => page(context, '自动扣款', AutoDebitsPage(session: s)),
                    ),
                    _action(
                      '明细',
                      LucideIcons.list,
                      () => page(
                        context,
                        '账户明细',
                        TransactionsPage(session: s, account: a),
                      ),
                    ),
                  ],
                ),
              ),
              SectionTitle(
                '近期活动',
                action: '全部',
                onTap: () => page(
                  context,
                  '账户明细',
                  TransactionsPage(session: s, account: a),
                ),
              ),
              if (s.transactions.isEmpty)
                const EmptyPanel('暂无交易记录')
              else
                Surface(
                  padding: EdgeInsets.zero,
                  child: Column(
                    children: [
                      for (final tx in s.transactions)
                        TransactionRow(
                          tx: tx,
                          currency: a['currency'],
                          onTap: () => page(
                            context,
                            '交易详情',
                            TransactionDetail(session: s, id: tx['id']),
                          ),
                        ),
                    ],
                  ),
                ),
              const SectionTitle('账户管理'),
              Surface(
                padding: EdgeInsets.zero,
                child: Column(
                  children: [
                    ListTile(
                      leading: const Icon(LucideIcons.creditCard),
                      title: const Text('银行卡'),
                      trailing: const Icon(LucideIcons.chevronRight, size: 18),
                      onTap: () => page(context, '银行卡', CardsPage(session: s)),
                    ),
                    const Divider(),
                    ListTile(
                      leading: const Icon(LucideIcons.arrowRightLeft),
                      title: const Text('换汇'),
                      trailing: const Icon(LucideIcons.chevronRight, size: 18),
                      onTap: () => sheet(context, ExchangeSheet(session: s)),
                    ),
                    const Divider(),
                    ListTile(
                      leading: const Icon(LucideIcons.barChart3),
                      title: const Text('消费分析与现金流'),
                      trailing: const Icon(LucideIcons.chevronRight, size: 18),
                      onTap: () =>
                          page(context, '消费分析与现金流', AnalysisPage(session: s)),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      );
    },
  );
  Widget _action(
    String label,
    IconData icon,
    VoidCallback tap, {
    bool gold = false,
  }) => Expanded(
    child: InkWell(
      onTap: tap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Column(
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: gold ? Palette.goldSoft : Palette.slateSoft,
                borderRadius: BorderRadius.circular(15),
              ),
              child: Icon(
                icon,
                size: 23,
                color: gold ? Palette.goldInk : Palette.muted,
              ),
            ),
            const SizedBox(height: 8),
            Text(label, style: const TextStyle(fontSize: 12)),
          ],
        ),
      ),
    ),
  );
}

String _tail(String text) =>
    text.length > 4 ? text.substring(text.length - 4) : text;

class TransactionRow extends StatelessWidget {
  final Json tx;
  final String currency;
  final VoidCallback onTap;
  const TransactionRow({
    super.key,
    required this.tx,
    required this.currency,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final incoming = tx['direction'] == 'in';
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 3),
      leading: Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: incoming ? const Color(0xffEDF6EF) : Palette.slateSoft,
          borderRadius: BorderRadius.circular(13),
        ),
        child: Icon(
          incoming ? LucideIcons.arrowDownLeft : LucideIcons.arrowUpRight,
          color: incoming ? Palette.green : Palette.muted,
          size: 20,
        ),
      ),
      title: Text(
        '${tx['counterparty']}',
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
      subtitle: Text(
        '${dateText(tx['createdAt'])} · ${statusText(tx['status'])}',
        style: const TextStyle(fontSize: 11, color: Palette.muted),
      ),
      trailing: Text(
        '${incoming ? '+' : '−'}${money(tx['amount'], currency: currency)}',
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: incoming ? Palette.green : Palette.ink,
          fontSize: 13,
        ),
      ),
    );
  }
}

class TransactionsPage extends StatefulWidget {
  final BankSession session;
  final Json account;
  const TransactionsPage({
    super.key,
    required this.session,
    required this.account,
  });
  @override
  State<TransactionsPage> createState() => _TransactionsPageState();
}

class _TransactionsPageState extends State<TransactionsPage> {
  final search = TextEditingController();
  int current = 1, total = 0;
  List<Json> items = [];
  bool busy = false;
  Object? error;
  @override
  void initState() {
    super.initState();
    load(reset: true);
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> load({bool reset = false}) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    final next = reset ? 1 : current + 1;
    try {
      final data = object(
        await widget.session.bank.call(
          'api/accounts/${widget.account['id']}/transactions',
          query: {'page': '$next', 'size': '20', 'keyword': search.text.trim()},
        ),
      );
      if (mounted) {
        setState(() {
          items = reset
              ? objects(data['items'])
              : [...items, ...objects(data['items'])];
          current = next;
          total = data['total'];
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: () => load(reset: true),
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        TextField(
          controller: search,
          onSubmitted: (_) => load(reset: true),
          decoration: InputDecoration(
            hintText: '搜索交易',
            prefixIcon: const Icon(LucideIcons.search, size: 20),
            suffixIcon: IconButton(
              onPressed: () => load(reset: true),
              icon: const Icon(LucideIcons.arrowRight, size: 18),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed: busy
                ? null
                : () async {
                    try {
                      final dataset = object(
                        await widget.session.bank.call(
                          'api/accounts/${widget.account['id']}/transactions/export',
                          query: {'keyword': search.text.trim()},
                        ),
                      );
                      await shareDataset(dataset);
                    } catch (e) {
                      if (context.mounted) notifyError(context, e);
                    }
                  },
            icon: const Icon(LucideIcons.download, size: 17),
            label: const Text('导出明细'),
          ),
        ),
        if (error != null) ErrorPanel(error!, retry: () => load(reset: true)),
        if (!busy && items.isEmpty && error == null) const EmptyPanel('暂无交易记录'),
        if (items.isNotEmpty)
          Surface(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (final tx in items)
                  TransactionRow(
                    tx: tx,
                    currency: widget.account['currency'],
                    onTap: () => page(
                      context,
                      '交易详情',
                      TransactionDetail(session: widget.session, id: tx['id']),
                    ),
                  ),
              ],
            ),
          ),
        if (busy)
          const Padding(
            padding: EdgeInsets.all(20),
            child: Center(child: CircularProgressIndicator()),
          ),
        if (items.length < total && !busy)
          TextButton(onPressed: load, child: const Text('加载更多')),
      ],
    ),
  );
}

class TransactionDetail extends StatelessWidget {
  final BankSession session;
  final String id;
  const TransactionDetail({super.key, required this.session, required this.id});
  @override
  Widget build(BuildContext context) => RemoteView(
    load: () =>
        session.bank.call('api/transactions/${Uri.encodeComponent(id)}'),
    builder: (data, reload) {
      final tx = object(data);
      final detail = object(tx['detail']);
      return ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Text(
            money(tx['amount'], currency: detail['settleCurrency'] ?? 'CNY'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Text(statusText(tx['status']), textAlign: TextAlign.center),
          const SizedBox(height: 24),
          Surface(
            child: Column(
              children: [
                pair('对方', '${tx['counterparty']}'),
                pair('交易时间', dateText(tx['createdAt'])),
                pair('交易编号', '${detail['referenceNo']}'),
                pair('付款方式', '${detail['paymentMethod']}'),
                pair('账户', '${detail['accountNo']}'),
                if (detail['counterpartyBank'] != null)
                  pair('对方银行', '${detail['counterpartyBank']}'),
                if (detail['counterpartyAccountNo'] != null)
                  pair('对方账号', '${detail['counterpartyAccountNo']}'),
                pair('备注', '${tx['memo']}'),
                pair(
                  '交易后余额',
                  money(
                    detail['balanceAfter'],
                    currency: detail['settleCurrency'] ?? 'CNY',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () async {
              try {
                final receipt = object(
                  await session.bank.call(
                    'api/transactions/${Uri.encodeComponent(id)}/receipt',
                  ),
                );
                await openReceipt(receipt);
              } catch (e) {
                if (context.mounted) notifyError(context, e);
              }
            },
            icon: const Icon(LucideIcons.fileText, size: 18),
            label: const Text('电子回单'),
          ),
          if (tx['status'] == 'pending' && tx['pendingReason'] == 'inflight')
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: OutlinedButton(
                onPressed: () async {
                  if (!await confirm(context, '撤销转账', '确认撤销这笔在途转账？')) return;
                  try {
                    await session.bank.call(
                      'api/transfers/$id/recall',
                      method: 'POST',
                      body: {},
                    );
                    await reload();
                    await session.refresh();
                  } catch (e) {
                    if (context.mounted) notifyError(context, e);
                  }
                },
                child: const Text('撤销在途转账'),
              ),
            ),
        ],
      );
    },
  );
}

class ReceivingSheet extends StatelessWidget {
  final BankSession session;
  const ReceivingSheet({super.key, required this.session});
  @override
  Widget build(BuildContext context) => SizedBox(
    height: 420,
    child: RemoteView(
      load: () => session.bank.call('api/receiving'),
      builder: (d, reload) {
        final data = object(d);
        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          children: [
            const Text(
              '收款信息',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            Surface(
              child: Column(
                children: [
                  pair('户名', '${data['holder']}'),
                  pair('开户行', '${data['bankName']}'),
                  pair('账号', '${data['accountNo']}'),
                  if (data['fpsRegistered'] == true) ...[
                    pair('FPS 手机号', '${data['fpsMobile']}'),
                    pair('FPS ID', '${data['fpsId']}'),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: () {
                Clipboard.setData(
                  ClipboardData(
                    text:
                        '${data['holder']}\n${data['bankName']}\n${data['accountNo']}',
                  ),
                );
                ScaffoldMessenger.of(
                  context,
                ).showSnackBar(const SnackBar(content: Text('收款信息已复制')));
              },
              icon: const Icon(LucideIcons.copy, size: 18),
              label: const Text('复制收款信息'),
            ),
          ],
        );
      },
    ),
  );
}
