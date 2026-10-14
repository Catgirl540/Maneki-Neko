import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:luckycat/core/api.dart';
import 'package:luckycat/core/updates.dart';
import 'package:luckycat/pages/update.dart';
import 'package:luckycat/ui/common.dart';

class TestPlatform implements UpdatePlatform {
  final Directory directory;
  int current = 1, sdk = 36, verifies = 0, installs = 0;
  bool debug = true, reject = false;
  String installResult = 'permissionRequired';
  Future<void> Function()? onVerify;
  TestPlatform(this.directory);
  @override
  bool get supported => true;
  @override
  Future<InstalledApp> info() async => InstalledApp({
    'packageName': 'cn.waveflow.luckycat',
    'versionName': '1.0.0',
    'versionCode': current,
    'sdk': sdk,
    'abis': ['arm64-v8a'],
    'debuggable': debug,
  });
  @override
  Future<String> downloadTarget(AndroidRelease release) async =>
      '${directory.path}/${release.fileName}.part';
  @override
  Future<void> verify(AndroidRelease release) async {
    verifies++;
    await onVerify?.call();
    if (reject) throw const ApiFailure('更新包签名与当前应用不一致');
  }

  @override
  Future<String> install(AndroidRelease release) async {
    installs++;
    return installResult;
  }
}

void main() {
  final binary = List<int>.generate(4096, (index) => index % 256);
  final hash = sha256.convert(binary).toString();
  late Directory directory;
  late TestPlatform platform;
  late Json metadata;
  final requests = <http.Request>[];
  late AppUpdater updater;
  http.Client normalClient() => MockClient((request) async {
    requests.add(request);
    if (request.url.path.endsWith('android.json')) {
      return http.Response(
        jsonEncode(metadata),
        200,
        headers: {'content-type': 'application/json'},
      );
    }
    return http.Response.bytes(
      binary,
      200,
      headers: {'content-type': 'application/vnd.android.package-archive'},
    );
  });
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('luckycat-update-test-');
    platform = TestPlatform(directory);
    requests.clear();
    metadata = {
      'schemaVersion': 1,
      'fileName': 'luckycat-android-${hash.substring(0, 12)}.apk',
      'versionName': '1.0.1',
      'versionCode': 2,
      'packageName': 'cn.waveflow.luckycat',
      'minSdk': 26,
      'bytes': binary.length,
      'sha256': hash,
      'debuggable': true,
      'abis': ['arm64-v8a', 'armeabi-v7a'],
    };
    updater = AppUpdater(
      'https://bank.example/bank',
      platform: platform,
      clientFactory: normalClient,
    );
  });
  tearDown(() async {
    updater.dispose();
    await directory.delete(recursive: true);
  });

  test('按实际 build 号判断更新，不把旧包当作可安装的新版本', () async {
    await updater.check();
    expect(updater.phase, UpdatePhase.available);
    expect(updater.hasUpdate, true);
    platform.current = 2;
    await updater.check();
    expect(updater.phase, UpdatePhase.current);
    platform.current = 3;
    await updater.check();
    expect(updater.phase, UpdatePhase.current);
    expect(platform.installs, 0);
    expect(
      requests.every(
        (request) =>
            !request.headers.containsKey('authorization') &&
            !request.followRedirects,
      ),
      true,
    );
    expect(
      requests.first.url.toString(),
      'https://bank.example/bank/downloads/android.json',
    );
  });
  test('拒绝跨站文件名、错误包名、错误摘要及不完整元数据', () {
    for (final override in [
      {'fileName': 'https://evil.example/bank.apk'},
      {'fileName': '../bank.apk'},
      {'packageName': 'other.app'},
      {'sha256': 'bad'},
      {'bytes': 501 * 1024 * 1024},
      {
        'abis': ['unsupported'],
      },
    ]) {
      expect(
        () => AndroidRelease.parse({...metadata, ...override}),
        throwsA(isA<ApiFailure>()),
      );
    }
  });
  test('系统/架构不兼容以及正式版到调试版均不能下载', () async {
    platform.sdk = 25;
    await updater.check();
    expect(updater.phase, UpdatePhase.incompatible);
    await updater.download();
    expect(platform.verifies, 0);
    platform.sdk = 36;
    metadata['abis'] = ['x86_64'];
    await updater.check();
    expect(updater.phase, UpdatePhase.incompatible);
    metadata['abis'] = ['arm64-v8a'];
    platform.debug = false;
    await updater.check();
    expect(updater.phase, UpdatePhase.incompatible);
  });
  test('正式版拒绝 HTTP 更新源，离线检查后可重试', () async {
    updater.dispose();
    platform.debug = false;
    updater = AppUpdater(
      'http://bank.example/bank',
      platform: platform,
      clientFactory: normalClient,
    );
    await updater.check();
    expect(updater.phase, UpdatePhase.failed);
    expect(requests, isEmpty);
    expect(updater.error, contains('HTTPS'));
    platform.debug = true;
    await updater.check();
    expect(updater.phase, UpdatePhase.available);
  });
  test('下载正确包、进度与校验完成后才允许安装，权限返回可继续', () async {
    await updater.check();
    await updater.install();
    expect(platform.installs, 0);
    await updater.download();
    expect(updater.phase, UpdatePhase.ready);
    expect(updater.progress, 1);
    expect(platform.verifies, 1);
    expect(
      await File('${directory.path}/${metadata['fileName']}').readAsBytes(),
      binary,
    );
    expect(await directory.list().length, 1);
    await updater.install();
    expect(updater.phase, UpdatePhase.permissionRequired);
    platform.installResult = 'installerOpened';
    await updater.install();
    expect(updater.phase, UpdatePhase.installerOpened);
    expect(platform.installs, 2);
    expect(requests.last.url.path, '/bank/downloads/${metadata['fileName']}');
  });
  test('摘要被篡改或原生签名校验拒绝时删除缓存、禁止安装', () async {
    metadata['sha256'] = 'a' * 64;
    metadata['fileName'] = 'luckycat-android-aaaaaaaaaaaa.apk';
    await updater.check();
    await updater.download();
    expect(updater.phase, UpdatePhase.failed);
    expect(platform.verifies, 0);
    expect(await directory.list().length, 0);
    metadata['sha256'] = hash;
    metadata['fileName'] = 'luckycat-android-${hash.substring(0, 12)}.apk';
    platform.reject = true;
    await updater.check();
    await updater.download();
    expect(updater.phase, UpdatePhase.failed);
    expect(await directory.list().length, 0);
    await updater.install();
    expect(platform.installs, 0);
  });
  test('短包/HTML 响应失败后可重试，不留下部分文件', () async {
    updater.dispose();
    var fail = true;
    updater = AppUpdater(
      'https://bank.example/bank',
      platform: platform,
      clientFactory: () => MockClient((request) async {
        if (request.url.path.endsWith('.json')) {
          return http.Response(
            jsonEncode(metadata),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        return fail
            ? http.Response(
                '<html>fallback</html>',
                200,
                headers: {'content-type': 'text/html'},
              )
            : http.Response.bytes(
                binary,
                200,
                headers: {'content-type': 'application/octet-stream'},
              );
      }),
    );
    await updater.check();
    await updater.download();
    expect(updater.phase, UpdatePhase.failed);
    expect(await directory.list().length, 0);
    fail = false;
    await updater.download();
    expect(updater.phase, UpdatePhase.ready);
  });
  test('取消下载等待清理后才可重试，不触发安装', () async {
    updater.dispose();
    final stream = StreamController<List<int>>();
    final started = Completer<void>();
    updater = AppUpdater(
      'https://bank.example/bank',
      platform: platform,
      clientFactory: () => MockClient.streaming((request, _) async {
        if (request.url.path.endsWith('.json')) {
          return http.StreamedResponse(
            Stream.value(utf8.encode(jsonEncode(metadata))),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        started.complete();
        return http.StreamedResponse(
          stream.stream,
          200,
          headers: {'content-type': 'application/octet-stream'},
        );
      }),
    );
    await updater.check();
    final download = updater.download();
    await started.future;
    updater.cancel();
    stream.add(binary.sublist(0, 32));
    await stream.close();
    await download;
    expect(updater.phase, UpdatePhase.cancelled);
    expect(await directory.list().length, 0);
    expect(platform.installs, 0);
  });
  test('退出应用时校验中的更新不进入安装态，并清理已下载文件', () async {
    final started = Completer<void>(), finish = Completer<void>();
    platform.onVerify = () async {
      started.complete();
      await finish.future;
    };
    await updater.check();
    final download = updater.download();
    await started.future;
    updater.dispose();
    finish.complete();
    await download;
    expect(await directory.list().length, 0);
    expect(platform.installs, 0);
  });

  testWidgets('更新页显示版本，权限返回后呈现继续安装入口', (tester) async {
    await tester.runAsync(() async {
      await updater.check();
      await updater.download();
      await updater.install();
    });
    await tester.pumpWidget(
      MaterialApp(
        theme: bankTheme(),
        home: Scaffold(body: UpdatePage(updater: updater)),
      ),
    );
    expect(find.text('需要安装权限'), findsOneWidget);
    expect(find.text('当前版本 1.0.0 (1)'), findsOneWidget);
    expect(find.text('新版本 1.0.1'), findsOneWidget);
    expect(find.text('继续安装'), findsOneWidget);
    expect(tester.takeException(), null);
    await tester.pumpWidget(const SizedBox());
  });
}
