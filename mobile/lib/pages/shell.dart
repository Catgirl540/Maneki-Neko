import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../core/session.dart';
import '../core/updates.dart';
import '../ui/common.dart';
import 'account.dart';
import 'wealth.dart';
import 'chat.dart';
import 'profile.dart';

class BankShell extends StatefulWidget {
  final BankSession session;
  final AppUpdater updater;
  const BankShell({super.key, required this.session, required this.updater});
  @override
  State<BankShell> createState() => _BankShellState();
}

class _BankShellState extends State<BankShell> {
  int index = 0;
  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      bottom: false,
      child: IndexedStack(
        index: index,
        children: [
          AccountPage(
            session: widget.session,
            onProfile: () => setState(() => index = 3),
          ),
          WealthPage(session: widget.session),
          ChatPage(session: widget.session),
          ProfilePage(
            session: widget.session,
            updater: widget.updater,
            onHelp: () => setState(() => index = 2),
          ),
        ],
      ),
    ),
    bottomNavigationBar: BankNavigation(
      index: index,
      onSelected: (i) => setState(() => index = i),
    ),
  );
}

class BankNavigation extends StatelessWidget {
  final int index;
  final ValueChanged<int> onSelected;
  const BankNavigation({
    super.key,
    required this.index,
    required this.onSelected,
  });
  @override
  Widget build(BuildContext context) => Container(
    decoration: const BoxDecoration(
      color: Colors.white,
      border: Border(top: BorderSide(color: Palette.line)),
    ),
    child: SafeArea(
      top: false,
      child: Row(
        children: [
          for (final (i, label, icon) in [
            (0, '账户', LucideIcons.wallet),
            (1, '理财', LucideIcons.lineChart),
            (2, '助手', LucideIcons.messageCircle),
            (3, '我的', LucideIcons.user),
          ])
            Expanded(
              child: Semantics(
                selected: index == i,
                button: true,
                label: label,
                child: InkWell(
                  onTap: () => onSelected(i),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 180),
                          width: 56,
                          height: 28,
                          decoration: BoxDecoration(
                            color: index == i
                                ? Palette.goldSoft
                                : Colors.transparent,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Icon(
                            icon,
                            size: 20,
                            color: index == i ? Palette.goldInk : Palette.muted,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          label,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: index == i
                                ? FontWeight.w700
                                : FontWeight.w500,
                            color: index == i ? Palette.goldInk : Palette.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    ),
  );
}
