import 'dart:convert';
import 'package:flutter/services.dart';
import 'api.dart';

const _files = MethodChannel('luckycat/files');
String csvDataset(Json dataset) {
  final columns = objects(dataset['columns']);
  String escape(String value) {
    // Treat exported strings as data when opened in spreadsheet software.
    final safe = RegExp(r'^[=+\-@\t\r]').hasMatch(value) ? "'$value" : value;
    return '"${safe.replaceAll('"', '""')}"';
  }

  return '\uFEFF${[columns.map((c) => escape('${c['label']}')).join(','), ...objects(dataset['rows']).map((row) => columns.map((c) => escape('${row[c['key']] ?? ''}')).join(','))].join('\r\n')}';
}

Future<void> shareDataset(Json dataset) async {
  try {
    await _files.invokeMethod('shareBytes', {
      'name': dataset['fileName'],
      'mime': 'text/csv',
      'data': Uint8List.fromList(utf8.encode(csvDataset(dataset))),
    });
  } on MissingPluginException {
    throw const ApiFailure('请在安卓版中导出文件');
  } on PlatformException {
    throw const ApiFailure('无法打开文件分享，请稍后重试');
  }
}

Future<void> openReceipt(Json receipt) async {
  if (receipt['url'] == null) throw const ApiFailure('当前银行服务暂未提供电子回单文件');
  final uri = Uri.tryParse('${receipt['url']}');
  if (uri == null ||
      !['https', 'http'].contains(uri.scheme) ||
      uri.host.isEmpty) {
    throw const ApiFailure('电子回单地址无效');
  }
  try {
    await _files.invokeMethod('openUrl', {'url': uri.toString()});
  } on MissingPluginException {
    throw const ApiFailure('请在安卓版中打开回单');
  } on PlatformException {
    throw const ApiFailure('无法打开电子回单');
  }
}
