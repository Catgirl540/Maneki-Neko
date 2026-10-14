import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../core/api.dart';
import 'cat_glyph.dart';

abstract final class Palette {
  static const canvas = Color(0xffF7F5F0),
      ink = Color(0xff0E1B26),
      gold = Color(0xffC8973C),
      goldInk = Color(0xff90621E),
      goldSoft = Color(0xffF8EED8),
      line = Color(0xffE8E2D8),
      muted = Color(0xff617387),
      slateSoft = Color(0xffF0F3F6),
      green = Color(0xff32865E);
}

ThemeData bankTheme() => ThemeData(
  useMaterial3: true,
  scaffoldBackgroundColor: Palette.canvas,
  colorScheme: ColorScheme.fromSeed(
    seedColor: Palette.gold,
    primary: Palette.gold,
    onPrimary: Palette.ink,
    surface: Colors.white,
    onSurface: Palette.ink,
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: Palette.canvas,
    foregroundColor: Palette.ink,
    centerTitle: false,
    elevation: 0,
    scrolledUnderElevation: 0,
  ),
  textTheme: ThemeData.light().textTheme.apply(
    bodyColor: Palette.ink,
    displayColor: Palette.ink,
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white,
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: const BorderSide(color: Palette.line),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: const BorderSide(color: Palette.line),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: const BorderSide(color: Palette.gold),
    ),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      minimumSize: const Size(0, 48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
  ),
  outlinedButtonTheme: OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      foregroundColor: Palette.ink,
      minimumSize: const Size(0, 48),
      side: const BorderSide(color: Palette.line),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
  ),
  dividerTheme: const DividerThemeData(
    color: Palette.line,
    thickness: 1,
    space: 1,
  ),
  bottomSheetTheme: const BottomSheetThemeData(
    backgroundColor: Palette.canvas,
    showDragHandle: true,
    modalBarrierColor: Colors.black38,
  ),
);

class Surface extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color color;
  const Surface({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.color = Colors.white,
  });
  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: Palette.line),
    ),
    child: child,
  );
}

class CatMark extends StatelessWidget {
  final double size;
  const CatMark({super.key, this.size = 40});
  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      color: Palette.goldSoft,
      borderRadius: BorderRadius.circular(13),
    ),
    child: Padding(
      padding: EdgeInsets.all(size * .1),
      child: CatGlyph(size: size * .8),
    ),
  );
}

class SectionTitle extends StatelessWidget {
  final String title;
  final String? action;
  final VoidCallback? onTap;
  const SectionTitle(this.title, {super.key, this.action, this.onTap});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 20, bottom: 10),
    child: Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
          ),
        ),
        if (action != null)
          TextButton(
            onPressed: onTap,
            child: Text(
              action!,
              style: const TextStyle(color: Palette.goldInk),
            ),
          ),
      ],
    ),
  );
}

class ErrorPanel extends StatelessWidget {
  final Object error;
  final VoidCallback? retry;
  const ErrorPanel(this.error, {super.key, this.retry});
  @override
  Widget build(BuildContext context) => Surface(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(LucideIcons.cloudOff, color: Palette.muted),
        const SizedBox(height: 12),
        Text('$error', textAlign: TextAlign.center),
        if (retry != null)
          TextButton(onPressed: retry, child: const Text('重试')),
      ],
    ),
  );
}

class EmptyPanel extends StatelessWidget {
  final String text;
  final Widget? action;
  const EmptyPanel(this.text, {super.key, this.action});
  @override
  Widget build(BuildContext context) => Surface(
    child: SizedBox(
      width: double.infinity,
      child: Column(
        children: [
          const SizedBox(height: 16),
          const Icon(LucideIcons.inbox, size: 30, color: Palette.muted),
          const SizedBox(height: 12),
          Text(text),
          if (action != null)
            Padding(padding: const EdgeInsets.only(top: 12), child: action),
          const SizedBox(height: 16),
        ],
      ),
    ),
  );
}

class RemoteView extends StatefulWidget {
  final Future<dynamic> Function() load;
  final Widget Function(dynamic data, Future<void> Function() reload) builder;
  const RemoteView({super.key, required this.load, required this.builder});
  @override
  State<RemoteView> createState() => _RemoteViewState();
}

class _RemoteViewState extends State<RemoteView> {
  dynamic data;
  Object? error;
  bool loading = true;
  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final value = await widget.load();
      if (mounted) setState(() => data = value);
    } catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (loading && data == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (error != null) {
      return Padding(
        padding: const EdgeInsets.all(18),
        child: ErrorPanel(error!, retry: reload),
      );
    }
    return RefreshIndicator(
      onRefresh: reload,
      child: widget.builder(data, reload),
    );
  }
}

Future<T?> sheet<T>(BuildContext context, Widget child) =>
    showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: child,
      ),
    );
Future<T?> page<T>(BuildContext context, String title, Widget child) =>
    Navigator.of(context).push<T>(
      MaterialPageRoute(
        builder: (_) => Scaffold(
          appBar: AppBar(title: Text(title)),
          body: SafeArea(child: child),
        ),
      ),
    );
void notifyError(BuildContext context, Object error) =>
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$error'), behavior: SnackBarBehavior.floating),
    );
Future<bool> confirm(BuildContext context, String title, String text) =>
    showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(text),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认'),
          ),
        ],
      ),
    ).then((v) => v ?? false);
Widget pair(String label, String value) => Padding(
  padding: const EdgeInsets.symmetric(vertical: 8),
  child: Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(
        child: Text(label, style: const TextStyle(color: Palette.muted)),
      ),
      const SizedBox(width: 12),
      Flexible(child: Text(value, textAlign: TextAlign.right)),
    ],
  ),
);

class FormFieldSpec {
  final String key, label;
  final bool secret, optional;
  final TextInputType? keyboard;
  final String? initial;
  final String? Function(String value)? validator;
  const FormFieldSpec(
    this.key,
    this.label, {
    this.secret = false,
    this.optional = false,
    this.keyboard,
    this.initial,
    this.validator,
  });
}

class ActionForm extends StatefulWidget {
  final String title, submitLabel;
  final List<FormFieldSpec> fields;
  final Widget? introduction;
  final Future<dynamic> Function(Map<String, String> values) submit;
  final String Function(dynamic)? success;
  const ActionForm({
    super.key,
    required this.title,
    required this.fields,
    required this.submit,
    this.submitLabel = '确认提交',
    this.introduction,
    this.success,
  });
  @override
  State<ActionForm> createState() => _ActionFormState();
}

class _ActionFormState extends State<ActionForm> {
  late final controls = {
    for (final f in widget.fields)
      f.key: TextEditingController(text: f.initial),
  };
  final form = GlobalKey<FormState>();
  bool busy = false, uncertain = false;
  String? error;
  @override
  void dispose() {
    for (final c in controls.values) {
      c.clear();
      c.dispose();
    }
    super.dispose();
  }

  Future<void> submit() async {
    if (busy || uncertain || !form.currentState!.validate()) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await widget.submit(
        controls.map(
          (k, v) => MapEntry(
            k,
            widget.fields.firstWhere((f) => f.key == k).secret
                ? v.text
                : v.text.trim(),
          ),
        ),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(widget.success?.call(result) ?? '操作成功')),
      );
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      for (final f in widget.fields.where((f) => f.secret)) {
        controls[f.key]!.clear();
      }
      if (mounted) {
        setState(() {
          error = '$e';
          uncertain = e is ApiFailure && e.outcomeUnknown;
        });
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !busy,
    child: SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      child: Form(
        key: form,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.title,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 20),
            if (widget.introduction != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: widget.introduction,
              ),
            for (final f in widget.fields)
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: TextFormField(
                  controller: controls[f.key],
                  obscureText: f.secret,
                  enableSuggestions: !f.secret,
                  autocorrect: !f.secret,
                  enabled: !busy,
                  keyboardType: f.keyboard,
                  decoration: InputDecoration(labelText: f.label),
                  validator: (v) => !f.optional && (v?.trim().isEmpty ?? true)
                      ? '请填写${f.label}'
                      : f.validator?.call(v ?? ''),
                ),
              ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            FilledButton(
              onPressed: busy || uncertain ? null : submit,
              child: Text(busy ? '提交中…' : widget.submitLabel),
            ),
            if (uncertain)
              const Padding(
                padding: EdgeInsets.only(top: 12),
                child: Text(
                  '提交结果尚未确认，请先核对账户或申请记录。',
                  style: TextStyle(fontSize: 13),
                ),
              ),
          ],
        ),
      ),
    ),
  );
}
