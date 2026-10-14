import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'api.dart';

class InstalledApp {
  final String packageName, versionName;
  final int versionCode, sdk;
  final List<String> abis;
  final bool debuggable;
  InstalledApp(Json data)
    : packageName = data['packageName'] as String,
      versionName = data['versionName'] as String,
      versionCode = data['versionCode'] as int,
      sdk = data['sdk'] as int,
      abis = List<String>.from(data['abis']),
      debuggable = data['debuggable'] == true;
}

class AndroidRelease {
  final String fileName, versionName, hash;
  final int versionCode, minSdk, bytes;
  final bool debuggable;
  final List<String> abis;
  final String notes;
  AndroidRelease._(Json data)
    : fileName = data['fileName'],
      versionName = data['versionName'],
      hash = data['sha256'],
      versionCode = data['versionCode'],
      minSdk = data['minSdk'],
      bytes = data['bytes'],
      debuggable = data['debuggable'],
      abis = List<String>.from(data['abis']),
      notes = data['releaseNotes'] is String
          ? (data['releaseNotes'] as String).substring(
              0,
              (data['releaseNotes'] as String).length.clamp(0, 2000),
            )
          : '';

  factory AndroidRelease.parse(dynamic value) {
    final data = object(value);
    final hash = data['sha256'], file = data['fileName'];
    if (data['schemaVersion'] != 1 ||
        data['packageName'] != 'cn.waveflow.luckycat' ||
        hash is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(hash) ||
        file != 'luckycat-android-${hash.substring(0, 12)}.apk' ||
        data['versionName'] is! String ||
        !RegExp(r'^[\w.+-]{1,40}$').hasMatch(data['versionName']) ||
        data['versionCode'] is! int ||
        data['versionCode'] < 1 ||
        data['minSdk'] is! int ||
        data['minSdk'] < 26 ||
        data['bytes'] is! int ||
        data['bytes'] < 1024 ||
        data['bytes'] > 500 * 1024 * 1024 ||
        data['debuggable'] is! bool ||
        data['abis'] is! List ||
        (data['abis'] as List).isEmpty ||
        !(data['abis'] as List).every(
          (abi) => ['arm64-v8a', 'armeabi-v7a', 'x86_64'].contains(abi),
        )) {
      throw const ApiFailure('更新信息无效，请稍后重试');
    }
    return AndroidRelease._(data);
  }
  Json get arguments => {
    'fileName': fileName,
    'sha256': hash,
    'bytes': bytes,
    'versionCode': versionCode,
  };
}

abstract class UpdatePlatform {
  bool get supported;
  Future<InstalledApp> info();
  Future<String> downloadTarget(AndroidRelease release);
  Future<void> verify(AndroidRelease release);
  Future<String> install(AndroidRelease release);
}

class AndroidUpdatePlatform implements UpdatePlatform {
  static const channel = MethodChannel('luckycat/updates');
  @override
  bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  @override
  Future<InstalledApp> info() async =>
      InstalledApp(object(await channel.invokeMethod('info')));
  @override
  Future<String> downloadTarget(AndroidRelease release) async => (await channel
      .invokeMethod<String>('downloadTarget', release.arguments))!;
  @override
  Future<void> verify(AndroidRelease release) =>
      channel.invokeMethod('verify', release.arguments);
  @override
  Future<String> install(AndroidRelease release) async =>
      (await channel.invokeMethod<String>('install', release.arguments))!;
}

enum UpdatePhase {
  idle,
  checking,
  current,
  available,
  incompatible,
  downloading,
  verifying,
  ready,
  installing,
  permissionRequired,
  installerOpened,
  failed,
  cancelled,
  unsupported,
}

/// 更新使用独立无鉴权 HTTP 客户端，绝不把银行令牌附到静态下载请求中。
class AppUpdater extends ChangeNotifier {
  final String base;
  final UpdatePlatform platform;
  final http.Client Function() clientFactory;
  AppUpdater(
    String base, {
    UpdatePlatform? platform,
    http.Client Function()? clientFactory,
  }) : base = Endpoints.normalize(base),
       platform = platform ?? AndroidUpdatePlatform(),
       clientFactory = clientFactory ?? http.Client.new;
  InstalledApp? installed;
  AndroidRelease? latest;
  UpdatePhase phase = UpdatePhase.idle;
  String? error;
  int received = 0;
  bool _disposed = false, _cancelled = false;
  http.Client? _client;
  bool get busy => [
    UpdatePhase.checking,
    UpdatePhase.downloading,
    UpdatePhase.verifying,
    UpdatePhase.installing,
  ].contains(phase);
  bool get hasUpdate =>
      installed != null &&
      latest != null &&
      latest!.versionCode > installed!.versionCode;
  double get progress =>
      latest == null ? 0 : (received / latest!.bytes).clamp(0, 1);
  void _set(UpdatePhase next, [String? message]) {
    if (_disposed) return;
    phase = next;
    error = message;
    notifyListeners();
  }

  Future<void> check() async {
    if (busy || _disposed) return;
    if (!platform.supported) {
      _set(UpdatePhase.unsupported);
      return;
    }
    _set(UpdatePhase.checking);
    latest = null;
    http.Client? client;
    try {
      installed = await platform.info();
      if (_disposed) return;
      if (!installed!.debuggable && !base.startsWith('https://')) {
        throw const ApiFailure('正式版更新地址需要使用 HTTPS');
      }
      client = _client = clientFactory();
      final response = await client
          .send(
            http.Request('GET', Uri.parse('$base/downloads/android.json'))
              ..followRedirects = false
              ..headers['Accept'] = 'application/json'
              ..headers['Cache-Control'] = 'no-cache',
          )
          .timeout(const Duration(seconds: 15));
      if (response.statusCode != 200 ||
          !(response.headers['content-type'] ?? '').contains(
            'application/json',
          )) {
        throw const ApiFailure('暂时无法获取更新信息');
      }
      final data = BytesBuilder(copy: false);
      await for (final chunk in response.stream.timeout(
        const Duration(seconds: 15),
      )) {
        if (data.length + chunk.length > 64 * 1024) {
          throw const ApiFailure('更新信息格式无效');
        }
        data.add(chunk);
      }
      if (_disposed) return;
      latest = AndroidRelease.parse(jsonDecode(utf8.decode(data.takeBytes())));
      if (!hasUpdate) {
        _set(UpdatePhase.current);
        return;
      }
      if (latest!.minSdk > installed!.sdk ||
          !latest!.abis.any(installed!.abis.contains)) {
        _set(UpdatePhase.incompatible, '新版本暂不支持当前设备');
      } else if (!installed!.debuggable && latest!.debuggable) {
        _set(UpdatePhase.incompatible, '当前为正式版，不能更新为调试版');
      } else {
        _set(UpdatePhase.available);
      }
    } catch (e) {
      _set(UpdatePhase.failed, _message(e, '无法检查更新，请检查网络后重试'));
    } finally {
      client?.close();
      if (identical(_client, client)) _client = null;
    }
  }

  Future<void> download() async {
    if (busy || _disposed || !hasUpdate || phase == UpdatePhase.incompatible) {
      return;
    }
    final release = latest!;
    _cancelled = false;
    received = 0;
    _set(UpdatePhase.downloading);
    File? partial, complete;
    IOSink? output;
    http.Client? client;
    bool accepted = false;
    try {
      final path = await platform.downloadTarget(release);
      if (_disposed || _cancelled) return;
      partial = File(path);
      if (!path.endsWith('.apk.part')) throw const ApiFailure('更新缓存路径无效');
      output = partial.openWrite();
      // 提前监听写盘错误，避免空间不足时成为未处理的异步异常。
      unawaited(output.done.catchError((_) {}));
      client = _client = clientFactory();
      final response = await client
          .send(
            http.Request(
                'GET',
                Uri.parse('$base/downloads/${release.fileName}'),
              )
              ..followRedirects = false
              ..headers['Accept'] =
                  'application/vnd.android.package-archive, application/octet-stream',
          )
          .timeout(const Duration(seconds: 15));
      if (response.statusCode != 200 ||
          !(response.headers['content-type'] ?? '').contains(
            RegExp(
              r'application/(vnd\.android\.package-archive|octet-stream|zip)',
            ),
          )) {
        throw const ApiFailure('安装包暂不可用，请重试');
      }
      if (response.contentLength != null &&
          response.contentLength != release.bytes) {
        throw const ApiFailure('安装包大小不符，请重新检查更新');
      }
      var notified = 0;
      await for (final chunk in response.stream.timeout(
        const Duration(seconds: 45),
      )) {
        if (_cancelled || _disposed) break;
        received += chunk.length;
        if (received > release.bytes) throw const ApiFailure('安装包大小不符');
        output.add(chunk);
        if (received - notified >= 256 * 1024 || received == release.bytes) {
          notified = received;
          notifyListeners();
          // 让磁盘写入跟上网络流，避免大安装包积在内存中。
          await output.flush();
        }
      }
      await output.flush();
      await output.close();
      output = null;
      if (_cancelled || _disposed) return;
      if (received != release.bytes) throw const ApiFailure('下载中断，请重新下载');
      _set(UpdatePhase.verifying);
      final digest = await sha256.bind(partial.openRead()).first;
      if (digest.toString() != release.hash) {
        throw const ApiFailure('安装包校验失败，请重新下载');
      }
      if (_cancelled || _disposed) return;
      complete = await partial.rename(path.substring(0, path.length - 5));
      if (_cancelled || _disposed) return;
      await platform.verify(release);
      if (_cancelled || _disposed) return;
      accepted = true;
      _set(UpdatePhase.ready);
    } catch (e) {
      if (!_cancelled) {
        _set(UpdatePhase.failed, _message(e, '下载失败，请检查网络或存储空间后重试'));
      }
    } finally {
      client?.close();
      if (identical(_client, client)) _client = null;
      try {
        await output?.close();
      } catch (_) {
        /* 清理未完成的写入。 */
      }
      if (!accepted) {
        for (final file in [partial, complete]) {
          try {
            if (file != null && await file.exists()) await file.delete();
          } catch (_) {
            /* 下次下载会清理残留文件。 */
          }
        }
      }
      if (_cancelled) _set(UpdatePhase.cancelled);
    }
  }

  void cancel() {
    if (![UpdatePhase.downloading, UpdatePhase.verifying].contains(phase)) {
      return;
    }
    _cancelled = true;
    _client?.close();
  }

  Future<void> install() async {
    if (_disposed ||
        ![
          UpdatePhase.ready,
          UpdatePhase.permissionRequired,
          UpdatePhase.installerOpened,
        ].contains(phase)) {
      return;
    }
    _set(UpdatePhase.installing);
    try {
      final result = await platform.install(latest!);
      if (result == 'permissionRequired') {
        _set(UpdatePhase.permissionRequired);
      } else if (result == 'installerOpened') {
        _set(UpdatePhase.installerOpened);
      } else {
        throw const ApiFailure('无法打开系统安装界面');
      }
    } catch (e) {
      _set(UpdatePhase.failed, _message(e, '无法安装更新，请重新下载后重试'));
    }
  }

  String _message(Object e, String fallback) => e is ApiFailure
      ? e.message
      : e is PlatformException
      ? e.message ?? fallback
      : fallback;
  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _cancelled = true;
    _client?.close();
    super.dispose();
  }
}
