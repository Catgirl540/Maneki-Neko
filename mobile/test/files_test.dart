import 'package:flutter_test/flutter_test.dart';
import 'package:luckycat/core/files.dart';

void main() {
  test('明细导出遵循服务端列顺序、转义单元格并阻止 CSV 公式注入', () {
    final csv = csvDataset({
      'columns': [
        {'key': 'name', 'label': '对方'},
        {'key': 'memo', 'label': '附言'},
      ],
      'rows': [
        {'name': '=HYPERLINK("x")', 'memo': '包含,逗号\n换行'},
        {'name': '正常姓名', 'memo': '他说"你好"'},
      ],
    });
    expect(csv.startsWith('\uFEFF"对方","附言"\r\n'), true);
    expect(csv, contains('"\'=HYPERLINK(""x"")"'));
    expect(csv, contains('"包含,逗号\n换行"'));
    expect(csv, contains('"他说""你好"""'));
  });
}
