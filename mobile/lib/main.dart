import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'core/api.dart';
import 'core/session.dart';
import 'core/updates.dart';
import 'ui/common.dart';
import 'pages/auth.dart';
import 'pages/shell.dart';
import 'pages/update.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: Colors.white,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );
  runApp(const LuckycatApp());
}

class LuckycatApp extends StatefulWidget {
  const LuckycatApp({super.key});
  @override
  State<LuckycatApp> createState() => _LuckycatAppState();
}

class _LuckycatAppState extends State<LuckycatApp> {
  BankSession session = BankSession(Endpoints());
  late AppUpdater updater = makeUpdater(session.endpoints);
  GlobalKey<NavigatorState> navigation = GlobalKey<NavigatorState>();
  bool hadUser = false;
  @override
  void initState() {
    super.initState();
    session.addListener(authChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) => checkStartup(updater));
  }

  AppUpdater makeUpdater(Endpoints endpoints) {
    const configured = String.fromEnvironment('UPDATE_BASE_URL');
    return AppUpdater(configured.isEmpty ? endpoints.bank : configured);
  }

  Future<void> checkStartup(AppUpdater current) async {
    await current.check();
    if (!mounted ||
        current != updater ||
        current.phase != UpdatePhase.available ||
        navigation.currentState?.canPop() == true) {
      return;
    }
    final context = navigation.currentState?.overlay?.context;
    if (context == null || !context.mounted) return;
    final open = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('发现新版本'),
        content: Text('招财猫银行 ${current.latest!.versionName} 已可下载。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('稍后'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('查看更新'),
          ),
        ],
      ),
    );
    if (open == true && mounted && current == updater && context.mounted) {
      await page(context, '应用更新', UpdatePage(updater: updater));
    }
  }

  void authChanged() {
    if (hadUser && session.user == null) {
      setState(() => navigation = GlobalKey<NavigatorState>());
    }
    hadUser = session.user != null;
  }

  void configure(Endpoints endpoints) {
    final old = session;
    final oldUpdater = updater;
    old.removeListener(authChanged);
    setState(() {
      session = BankSession(endpoints);
      updater = makeUpdater(endpoints);
    });
    session.addListener(authChanged);
    old.dispose();
    oldUpdater.dispose();
    unawaited(checkStartup(updater));
  }

  @override
  void dispose() {
    session.removeListener(authChanged);
    session.dispose();
    updater.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: navigation,
    title: '招财猫银行',
    debugShowCheckedModeBanner: false,
    theme: bankTheme(),
    home: AnimatedBuilder(
      animation: session,
      builder: (context, _) => session.user == null
          ? AuthPage(
              key: ValueKey(session.endpoints),
              session: session,
              onConfigure: configure,
            )
          : BankShell(
              key: ValueKey(session.user!['id']),
              session: session,
              updater: updater,
            ),
    ),
  );
}
