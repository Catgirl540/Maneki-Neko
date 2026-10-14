import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../ui/common.dart';

class AuthPage extends StatefulWidget {
  final BankSession session;
  final void Function(Endpoints) onConfigure;
  const AuthPage({super.key, required this.session, required this.onConfigure});
  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  final form = GlobalKey<FormState>();
  final phone = TextEditingController(),
      password = TextEditingController(),
      sms = TextEditingController(),
      name = TextEditingController(),
      identity = TextEditingController(),
      repeat = TextEditingController();
  bool register = false, busy = false, smsBusy = false, pledged = false;
  String? ticket, error;
  @override
  void dispose() {
    for (final c in [phone, password, sms, name, identity, repeat]) {
      c.clear();
      c.dispose();
    }
    super.dispose();
  }

  Future<void> sendSms() async {
    if (phone.text.trim().isEmpty) {
      setState(() => error = '请填写手机号');
      return;
    }
    setState(() => smsBusy = true);
    try {
      final data = object(
        await widget.session.bank.call(
          'api/auth/sms-code',
          method: 'POST',
          body: {'phone': phone.text.trim()},
        ),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            data['demoCode'] != null ? '测试服务验证码：${data['demoCode']}' : '验证码已发送',
          ),
        ),
      );
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => smsBusy = false);
    }
  }

  Future<void> verify() async {
    setState(() => busy = true);
    try {
      final result = object(
        await widget.session.bank.call(
          'api/security/verify',
          method: 'POST',
          body: {'channel': 'face'},
        ),
      );
      if (result['ticket'] is! String) throw const ApiFailure('核验未完成');
      if (mounted) setState(() => ticket = result['ticket']);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> submit() async {
    if (!form.currentState!.validate()) return;
    if (register && (ticket == null || !pledged)) {
      setState(() => error = '请完成身份核验并确认开户承诺');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final data = object(
        await widget.session.bank.call(
          register ? 'api/auth/register' : 'api/auth/login',
          method: 'POST',
          body: {
            'phone': phone.text.trim(),
            'password': password.text,
            'smsCode': sms.text.trim(),
            if (register) ...{
              'holderName': name.text.trim(),
              'idNumber': identity.text.trim(),
              'faceTicket': ticket,
              'pledge': openingPledge,
            },
          },
        ),
      );
      await widget.session.authenticate(data);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget input(
    TextEditingController control,
    String label, {
    bool secret = false,
    TextInputType? keyboard,
    String? Function(String?)? validator,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: TextFormField(
      controller: control,
      obscureText: secret,
      enabled: !busy,
      keyboardType: keyboard,
      enableSuggestions: !secret,
      autocorrect: !secret,
      decoration: InputDecoration(labelText: label),
      validator:
          validator ?? (v) => (v?.trim().isEmpty ?? true) ? '请填写$label' : null,
    ),
  );
  Future<void> configure() async {
    await sheet(
      context,
      ActionForm(
        title: '连接服务',
        fields: [
          FormFieldSpec(
            'bank',
            '银行服务地址',
            initial: widget.session.endpoints.bank,
          ),
          FormFieldSpec(
            'agent',
            '助手服务地址',
            initial: widget.session.endpoints.agent,
          ),
        ],
        submit: (v) async {
          final endpoints = Endpoints(bank: v['bank'], agent: v['agent']);
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => widget.onConfigure(endpoints),
          );
          return true;
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const CatMark(size: 48),
                      const SizedBox(width: 12),
                      const Expanded(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(
                            'luckycat',
                            style: TextStyle(
                              fontSize: 26,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -1,
                            ),
                          ),
                        ),
                      ),
                      if (kDebugMode)
                        IconButton(
                          onPressed: configure,
                          icon: const Icon(LucideIcons.settings2),
                          tooltip: '连接服务',
                        ),
                    ],
                  ),
                  const SizedBox(height: 42),
                  Text(
                    register ? '注册并开通储蓄账户' : '欢迎回来',
                    style: const TextStyle(
                      fontSize: 27,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 26),
                  if (register) ...[input(name, '姓名'), input(identity, '身份证号')],
                  input(phone, '手机号', keyboard: TextInputType.phone),
                  input(password, '登录密码', secret: true),
                  if (register)
                    input(
                      repeat,
                      '确认登录密码',
                      secret: true,
                      validator: (v) => v != password.text ? '两次密码不一致' : null,
                    ),
                  Row(
                    children: [
                      Expanded(
                        child: input(
                          sms,
                          '短信验证码',
                          keyboard: TextInputType.number,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: TextButton(
                          onPressed: smsBusy || busy ? null : sendSms,
                          child: Text(smsBusy ? '发送中…' : '获取验证码'),
                        ),
                      ),
                    ],
                  ),
                  if (register) ...[
                    OutlinedButton.icon(
                      onPressed: busy ? null : verify,
                      icon: Icon(
                        ticket == null
                            ? LucideIcons.scanFace
                            : LucideIcons.checkCircle2,
                      ),
                      label: Text(ticket == null ? '开始身份核验' : '身份核验已完成'),
                    ),
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: pledged,
                      onChanged: busy
                          ? null
                          : (v) => setState(() => pledged = v ?? false),
                      title: const Text(
                        openingPledge,
                        style: TextStyle(fontSize: 12, height: 1.6),
                      ),
                      controlAffinity: ListTileControlAffinity.leading,
                    ),
                  ],
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Text(
                        error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  FilledButton(
                    onPressed: busy ? null : submit,
                    child: Text(
                      busy
                          ? '请稍候…'
                          : register
                          ? '确认注册并开户'
                          : '登录',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => setState(() {
                            register = !register;
                            error = null;
                            ticket = null;
                            pledged = false;
                          }),
                    child: Text(
                      register ? '已有账户？去登录' : '还没有账户？注册开户',
                      style: const TextStyle(color: Palette.goldInk),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
