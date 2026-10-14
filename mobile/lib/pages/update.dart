import 'dart:async';
import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../core/updates.dart';
import '../ui/common.dart';

class UpdatePage extends StatefulWidget {
  final AppUpdater updater;
  const UpdatePage({super.key, required this.updater});
  @override
  State<UpdatePage> createState() => _UpdatePageState();
}

class _UpdatePageState extends State<UpdatePage> {
  @override
  void initState() {
    super.initState();
    if ([UpdatePhase.idle, UpdatePhase.failed].contains(widget.updater.phase)) {
      unawaited(widget.updater.check());
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.updater,
    builder: (context, _) {
      final updates = widget.updater;
      final release = updates.latest;
      final status = switch (updates.phase) {
        UpdatePhase.idle || UpdatePhase.checking => '正在检查更新',
        UpdatePhase.current => '已是最新版本',
        UpdatePhase.available => '发现新版本',
        UpdatePhase.incompatible => '暂不支持此更新',
        UpdatePhase.downloading => '正在下载更新',
        UpdatePhase.verifying => '正在校验安装包',
        UpdatePhase.ready => '更新已准备好',
        UpdatePhase.installing => '正在打开安装界面',
        UpdatePhase.permissionRequired => '需要安装权限',
        UpdatePhase.installerOpened => '已打开系统安装界面',
        UpdatePhase.failed => '更新暂未完成',
        UpdatePhase.cancelled => '下载已取消',
        UpdatePhase.unsupported => '请在安卓版中检查更新',
      };
      final installReady = [
        UpdatePhase.ready,
        UpdatePhase.permissionRequired,
        UpdatePhase.installerOpened,
      ].contains(updates.phase);
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 20),
          const Center(child: CatMark(size: 72)),
          const SizedBox(height: 24),
          Text(
            status,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w700),
          ),
          if (updates.installed != null) ...[
            const SizedBox(height: 12),
            Text(
              '当前版本 ${updates.installed!.versionName} (${updates.installed!.versionCode})',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Palette.muted),
            ),
          ],
          const SizedBox(height: 28),
          if (updates.hasUpdate && release != null)
            Surface(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '新版本 ${release.versionName}',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${(release.bytes / 1024 / 1024).toStringAsFixed(1)} MB${release.debuggable ? ' · 调试版' : ''}',
                    style: const TextStyle(color: Palette.muted),
                  ),
                  if (release.notes.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Text(release.notes),
                  ],
                ],
              ),
            ),
          if (updates.error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Text(
                updates.error!,
                textAlign: TextAlign.center,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          if (updates.phase == UpdatePhase.downloading) ...[
            const SizedBox(height: 24),
            LinearProgressIndicator(
              value: updates.progress,
              minHeight: 6,
              borderRadius: BorderRadius.circular(3),
            ),
            const SizedBox(height: 12),
            Text(
              '${(updates.progress * 100).floor()}%  ${(updates.received / 1024 / 1024).toStringAsFixed(1)} / ${(release!.bytes / 1024 / 1024).toStringAsFixed(1)} MB',
              textAlign: TextAlign.center,
            ),
            TextButton(onPressed: updates.cancel, child: const Text('取消下载')),
          ] else if (updates.busy) ...[
            const SizedBox(height: 24),
            const Center(child: CircularProgressIndicator()),
          ] else if (installReady) ...[
            if (updates.phase == UpdatePhase.permissionRequired)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text(
                  '请在系统设置中允许招财猫银行安装应用，返回后继续安装。',
                  textAlign: TextAlign.center,
                ),
              ),
            if (updates.phase == UpdatePhase.installerOpened)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text(
                  '请在系统安装界面完成更新。取消安装后也可以重新打开。',
                  textAlign: TextAlign.center,
                ),
              ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: updates.install,
              icon: const Icon(LucideIcons.download, size: 18),
              label: Text(
                updates.phase == UpdatePhase.permissionRequired
                    ? '继续安装'
                    : updates.phase == UpdatePhase.installerOpened
                    ? '再次打开安装'
                    : '安装更新',
              ),
            ),
          ] else if (updates.hasUpdate &&
              updates.phase != UpdatePhase.incompatible) ...[
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: updates.download,
              icon: const Icon(LucideIcons.download, size: 18),
              label: Text(
                updates.phase == UpdatePhase.available ? '下载更新' : '重新下载',
              ),
            ),
          ] else if (updates.phase != UpdatePhase.unsupported) ...[
            const SizedBox(height: 24),
            OutlinedButton(onPressed: updates.check, child: const Text('重新检查')),
          ],
        ],
      );
    },
  );
}
