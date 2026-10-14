import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:image_picker/image_picker.dart';
import 'package:lucide_icons/lucide_icons.dart';
import 'package:record/record.dart';
import '../core/api.dart';
import '../core/chat.dart';
import '../core/session.dart';
import '../ui/common.dart';

class ChatPage extends StatefulWidget {
  final BankSession session;
  const ChatPage({super.key, required this.session});
  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> with WidgetsBindingObserver {
  late final ChatController chat = ChatController(widget.session);
  final input = TextEditingController();
  final scroll = ScrollController();
  final recorder = AudioRecorder();
  final player = AudioPlayer();
  final picker = ImagePicker();
  final pcm = BytesBuilder();
  StreamSubscription<Uint8List>? recordingSubscription;
  Timer? recordingTimer;
  Uint8List? imageBytes;
  String imageMime = 'image/jpeg';
  bool recording = false, mediaBusy = false, speaking = false;
  String? speechMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    chat.addListener(onChat);
    unawaited(recoverImage());
    player.onPlayerComplete.listen((_) {
      if (mounted) {
        setState(() {
          speaking = false;
          speechMessage = null;
        });
      }
    });
  }

  Future<void> recoverImage() async {
    try {
      final lost = await picker.retrieveLostData();
      if (lost.files?.isNotEmpty == true) await prepareImage(lost.files!.first);
    } catch (_) {
      /* No picker recovery on web or unsupported platforms. */
    }
  }

  void onChat() {
    if (!mounted) return;
    setState(() {});
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && scroll.hasClients && scroll.position.extentAfter < 320) {
        scroll.animateTo(
          scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) {
      chat.clearSecret();
      unawaited(player.stop());
      if (recording) unawaited(cancelRecording());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    chat.removeListener(onChat);
    chat.dispose();
    recordingTimer?.cancel();
    unawaited(recordingSubscription?.cancel());
    unawaited(recorder.dispose());
    unawaited(player.dispose());
    input.dispose();
    scroll.dispose();
    imageBytes = null;
    pcm.clear();
    super.dispose();
  }

  Future<void> send([String? text]) async {
    final value = text ?? input.text;
    final attached = imageBytes;
    try {
      await chat.send(
        value,
        image: attached == null
            ? null
            : {'data': base64Encode(attached), 'mimeType': imageMime},
      );
      if (mounted) {
        setState(() {
          input.clear();
          imageBytes = null;
        });
      }
    } catch (e) {
      if (mounted) notifyError(context, e);
    }
  }

  Future<void> prepareImage(XFile file) async {
    final bytes = await file.readAsBytes();
    if (bytes.length > 5 * 1024 * 1024) throw const ApiFailure('图片不能超过 5 MB');
    final mime = bytes.length > 3 && bytes[0] == 0xff && bytes[1] == 0xd8
        ? 'image/jpeg'
        : bytes.length > 8 && bytes[0] == 0x89 && bytes[1] == 0x50
        ? 'image/png'
        : bytes.length > 12 &&
              ascii.decode(bytes.sublist(0, 4), allowInvalid: true) == 'RIFF' &&
              ascii.decode(bytes.sublist(8, 12), allowInvalid: true) == 'WEBP'
        ? 'image/webp'
        : null;
    if (mime == null) throw const ApiFailure('请选择 JPG、PNG 或 WebP 图片');
    if (mounted) {
      setState(() {
        imageBytes = bytes;
        imageMime = mime;
      });
    }
  }

  Future<void> attach() async {
    await sheet(
      context,
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '添加图片',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              ),
            ),
            const SizedBox(height: 12),
            for (final (label, source, icon) in [
              ('从相册选择', ImageSource.gallery, LucideIcons.image),
              ('拍照', ImageSource.camera, LucideIcons.camera),
            ])
              ListTile(
                leading: Icon(icon, color: Palette.goldInk),
                title: Text(label),
                onTap: () async {
                  Navigator.pop(context);
                  try {
                    final file = await picker.pickImage(
                      source: source,
                      maxWidth: 1600,
                      maxHeight: 1600,
                      imageQuality: 85,
                    );
                    if (file != null) await prepareImage(file);
                  } catch (e) {
                    if (mounted) notifyError(context, e);
                  }
                },
              ),
          ],
        ),
      ),
    );
  }

  Future<void> voice() async {
    if (recording) {
      await finishRecording();
      return;
    }
    if (chat.health?['voice']?['asr'] != true) {
      notifyError(context, const ApiFailure('当前助手服务未启用语音识别'));
      return;
    }
    try {
      if (!await recorder.hasPermission()) throw const ApiFailure('请允许麦克风权限');
      pcm.clear();
      final stream = await recorder.startStream(
        const RecordConfig(
          encoder: AudioEncoder.pcm16bits,
          sampleRate: 16000,
          numChannels: 1,
        ),
      );
      recordingSubscription = stream.listen(
        (bytes) {
          if (pcm.length < 16000 * 2 * 60) pcm.add(bytes);
        },
        onError: (Object e) {
          unawaited(cancelRecording());
          if (mounted) notifyError(context, e);
        },
      );
      if (!mounted) {
        await recorder.cancel();
        return;
      }
      setState(() => recording = true);
      recordingTimer = Timer(
        const Duration(seconds: 60),
        () => unawaited(finishRecording()),
      );
    } catch (e) {
      if (mounted) notifyError(context, e);
    }
  }

  Future<void> cancelRecording() async {
    recordingTimer?.cancel();
    await recorder.cancel();
    await recordingSubscription?.cancel();
    recordingSubscription = null;
    pcm.clear();
    if (mounted) setState(() => recording = false);
  }

  Future<void> finishRecording() async {
    if (!recording || mediaBusy) return;
    recordingTimer?.cancel();
    setState(() {
      recording = false;
      mediaBusy = true;
    });
    try {
      await recorder.stop();
      await recordingSubscription?.cancel();
      recordingSubscription = null;
      final bytes = pcm.takeBytes();
      if (bytes.length < 3200) throw const ApiFailure('录音太短，请重试');
      final audio = wav(bytes);
      final result = object(
        await widget.session.agent.call(
          'agent-api/asr',
          method: 'POST',
          body: {
            'audio': base64Encode(audio),
            'mimeType': 'audio/wav',
            'language': 'zh',
          },
          timeout: const Duration(seconds: 65),
        ),
      );
      if (mounted) input.text = '${result['text'] ?? ''}';
    } catch (e) {
      if (mounted) notifyError(context, e);
    } finally {
      pcm.clear();
      if (mounted) setState(() => mediaBusy = false);
    }
  }

  Future<void> speak(Json message) async {
    if (speaking) {
      await player.stop();
      if (mounted) {
        setState(() {
          speaking = false;
          speechMessage = null;
        });
      }
      return;
    }
    setState(() {
      speaking = true;
      speechMessage = message['id'];
    });
    try {
      final text = '${message['text']}'.replaceAll(RegExp(r'[`#*_>\[\]]'), '');
      final bytes = await widget.session.agent.speech(text);
      if (mounted && speaking) {
        await player.play(BytesSource(bytes, mimeType: 'audio/mpeg'));
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          speaking = false;
          speechMessage = null;
        });
        notifyError(context, e);
      }
    }
  }

  Future<void> history() async {
    await sheet(
      context,
      StatefulBuilder(
        builder: (context, refresh) => SizedBox(
          height: MediaQuery.sizeOf(context).height * .6,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
            children: [
              const Text(
                '历史对话',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 14),
              for (final conversation in [...chat.conversations])
                ListTile(
                  title: Text('${conversation['title']}'),
                  leading: const Icon(LucideIcons.messageSquare, size: 20),
                  selected: conversation['id'] == chat.current?['id'],
                  onTap: () async {
                    try {
                      await chat.select(conversation);
                      if (context.mounted) Navigator.pop(context);
                    } catch (e) {
                      if (context.mounted) notifyError(context, e);
                    }
                  },
                  trailing: IconButton(
                    tooltip: '删除对话',
                    onPressed: () async {
                      if (!await confirm(context, '删除对话', '确认删除这条本机历史记录？')) {
                        return;
                      }
                      try {
                        await chat.remove(conversation);
                        refresh(() {});
                      } catch (e) {
                        if (context.mounted) notifyError(context, e);
                      }
                    },
                    icon: const Icon(LucideIcons.trash2, size: 18),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final online = chat.connectionLabel == '在线';
    final messages = chat.messages;
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(16, 8, 10, 10),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: Palette.line)),
          ),
          child: Row(
            children: [
              const Text(
                '助手',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              ),
              const SizedBox(width: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: online ? const Color(0xffEDF6EF) : Palette.slateSoft,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.circle,
                      size: 6,
                      color: online ? Palette.green : Palette.muted,
                    ),
                    const SizedBox(width: 5),
                    Text(
                      chat.connectionLabel,
                      style: TextStyle(
                        fontSize: 11,
                        color: online ? Palette.green : Palette.muted,
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              IconButton(
                onPressed: history,
                icon: const Icon(LucideIcons.history, size: 21),
                tooltip: '历史对话',
              ),
              IconButton(
                onPressed: chat.busy
                    ? null
                    : () async {
                        try {
                          await chat.newConversation();
                        } catch (e) {
                          if (context.mounted) notifyError(context, e);
                        }
                      },
                icon: const Icon(LucideIcons.edit, size: 21),
                tooltip: '新对话',
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            controller: scroll,
            padding: const EdgeInsets.all(16),
            children: [
              if (messages.isEmpty) ...[
                const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CatMark(size: 38),
                    SizedBox(width: 10),
                    Expanded(
                      child: Surface(
                        padding: EdgeInsets.all(14),
                        child: Text(
                          '你好，我是招财猫助手。\n今天有什么可以帮你？',
                          style: TextStyle(fontSize: 14, height: 1.7),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                for (final prompt in ['帮我查一下余额', '怎么给他人转账', '看看本月账单'])
                  Padding(
                    padding: const EdgeInsets.only(bottom: 9),
                    child: Surface(
                      padding: EdgeInsets.zero,
                      child: ListTile(
                        dense: true,
                        title: Text(
                          prompt,
                          style: const TextStyle(fontSize: 14),
                        ),
                        trailing: const Icon(
                          LucideIcons.arrowUpRight,
                          size: 17,
                          color: Palette.muted,
                        ),
                        onTap: chat.connecting || chat.busy
                            ? null
                            : () => send(prompt),
                      ),
                    ),
                  ),
              ],
              for (final m in messages)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: _bubble(m),
                ),
              if (chat.toolStatus != null)
                Text(
                  chat.toolStatus!,
                  style: const TextStyle(color: Palette.muted, fontSize: 12),
                ),
              if (chat.busy)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ),
                ),
              if (chat.consent != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Surface(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          '请确认操作',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                          ),
                        ),
                        for (final field in objects(chat.consent!['fields']))
                          pair('${field['label']}', '${field['value']}'),
                        const SizedBox(height: 10),
                        FilledButton(
                          onPressed: () => showDialog(
                            context: context,
                            builder: (_) => ConsentDialog(
                              chat: chat,
                              challenge: chat.consent!,
                            ),
                          ),
                          child: const Text('查看并确认'),
                        ),
                      ],
                    ),
                  ),
                ),
              if (chat.question != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Surface(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          '需要补充信息',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 10),
                        OutlinedButton(
                          onPressed: () => sheet(
                            context,
                            QuestionForm(chat: chat, question: chat.question!),
                          ),
                          child: const Text('回答问题'),
                        ),
                      ],
                    ),
                  ),
                ),
              if (chat.secret != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Surface(
                    child: Column(
                      children: [
                        pair('卡片安全信息', '${chat.secret!['value']}'),
                        TextButton(
                          onPressed: chat.clearSecret,
                          child: const Text('隐藏'),
                        ),
                      ],
                    ),
                  ),
                ),
              if (chat.error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 14),
                  child: Surface(
                    child: Column(
                      children: [
                        Text(
                          chat.error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                            fontSize: 13,
                          ),
                        ),
                        if (!chat.connecting && !online)
                          TextButton(
                            onPressed: () async {
                              try {
                                await chat.connect();
                              } catch (e) {
                                if (context.mounted) notifyError(context, e);
                              }
                            },
                            child: const Text('重新连接'),
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        if (imageBytes != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.memory(
                    imageBytes!,
                    width: 56,
                    height: 56,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(width: 10),
                const Text('已添加图片'),
                const Spacer(),
                IconButton(
                  onPressed: () => setState(() => imageBytes = null),
                  icon: const Icon(LucideIcons.x, size: 18),
                  tooltip: '移除图片',
                ),
              ],
            ),
          ),
        Container(
          padding: const EdgeInsets.fromLTRB(10, 10, 14, 12),
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: Palette.line)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(
                      color: recording ? Palette.gold : Palette.line,
                    ),
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      IconButton(
                        onPressed: chat.busy || recording || mediaBusy
                            ? null
                            : attach,
                        icon: const Icon(LucideIcons.plus, size: 21),
                        tooltip: '添加图片',
                      ),
                      Expanded(
                        child: TextField(
                          controller: input,
                          enabled: !recording && !mediaBusy,
                          minLines: 1,
                          maxLines: 4,
                          textInputAction: TextInputAction.newline,
                          decoration: InputDecoration(
                            hintText: recording
                                ? '正在录音…'
                                : mediaBusy
                                ? '正在识别…'
                                : '输入你的问题',
                            border: InputBorder.none,
                            enabledBorder: InputBorder.none,
                            focusedBorder: InputBorder.none,
                            fillColor: Colors.transparent,
                            contentPadding: const EdgeInsets.symmetric(
                              vertical: 13,
                            ),
                          ),
                          style: const TextStyle(fontSize: 14),
                        ),
                      ),
                      IconButton(
                        onPressed: chat.busy || mediaBusy ? null : voice,
                        icon: Icon(
                          recording ? LucideIcons.square : LucideIcons.mic,
                          size: 20,
                          color: recording ? Palette.goldInk : Palette.muted,
                        ),
                        tooltip: recording ? '结束录音' : '语音输入',
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 46,
                height: 46,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    padding: EdgeInsets.zero,
                    shape: const CircleBorder(),
                  ),
                  onPressed: recording
                      ? finishRecording
                      : chat.busy
                      ? () async {
                          try {
                            await chat.stop();
                          } catch (e) {
                            if (context.mounted) notifyError(context, e);
                          }
                        }
                      : chat.connecting || mediaBusy
                      ? null
                      : () => send(),
                  child: Icon(
                    chat.busy || recording
                        ? LucideIcons.square
                        : LucideIcons.send,
                    size: 20,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _bubble(Json message) {
    final user = message['role'] == 'user';
    final text = '${message['text']}';
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: user ? MainAxisAlignment.end : MainAxisAlignment.start,
      children: [
        if (!user) ...[const CatMark(size: 32), const SizedBox(width: 10)],
        Flexible(
          child: Column(
            crossAxisAlignment: user
                ? CrossAxisAlignment.end
                : CrossAxisAlignment.start,
            children: [
              Container(
                constraints: BoxConstraints(
                  maxWidth: MediaQuery.sizeOf(context).width * .78,
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 12,
                ),
                decoration: BoxDecoration(
                  color: user ? Palette.ink : Colors.white,
                  border: user ? null : Border.all(color: Palette.line),
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(user ? 16 : 5),
                    topRight: Radius.circular(user ? 5 : 16),
                    bottomLeft: const Radius.circular(16),
                    bottomRight: const Radius.circular(16),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (message['hasImage'] == true)
                      const Padding(
                        padding: EdgeInsets.only(bottom: 8),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              LucideIcons.image,
                              color: Colors.white70,
                              size: 18,
                            ),
                            SizedBox(width: 6),
                            Text('图片', style: TextStyle(color: Colors.white70)),
                          ],
                        ),
                      ),
                    if (user)
                      Text(
                        text,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          height: 1.6,
                        ),
                      )
                    else
                      MarkdownBody(
                        data: text.isEmpty ? '…' : text,
                        selectable: true,
                        styleSheet: MarkdownStyleSheet(
                          p: const TextStyle(
                            color: Palette.ink,
                            fontSize: 14,
                            height: 1.65,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              if (!user && text.isNotEmpty)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: text));
                        ScaffoldMessenger.of(
                          context,
                        ).showSnackBar(const SnackBar(content: Text('已复制')));
                      },
                      icon: const Icon(
                        LucideIcons.copy,
                        size: 16,
                        color: Palette.muted,
                      ),
                      tooltip: '复制回复',
                    ),
                    if (chat.health?['voice']?['tts'] == true)
                      IconButton(
                        onPressed: () => speak(message),
                        icon: Icon(
                          speechMessage == message['id']
                              ? LucideIcons.square
                              : LucideIcons.volume2,
                          size: 17,
                          color: Palette.muted,
                        ),
                        tooltip: speechMessage == message['id']
                            ? '停止朗读'
                            : '朗读回复',
                      ),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }
}

Uint8List wav(Uint8List pcm, {int sampleRate = 16000}) {
  final header = ByteData(44);
  void tag(int offset, String value) {
    for (var i = 0; i < value.length; i++) {
      header.setUint8(offset + i, value.codeUnitAt(i));
    }
  }

  tag(0, 'RIFF');
  header.setUint32(4, 36 + pcm.length, Endian.little);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  header.setUint32(16, 16, Endian.little);
  header.setUint16(20, 1, Endian.little);
  header.setUint16(22, 1, Endian.little);
  header.setUint32(24, sampleRate, Endian.little);
  header.setUint32(28, sampleRate * 2, Endian.little);
  header.setUint16(32, 2, Endian.little);
  header.setUint16(34, 16, Endian.little);
  tag(36, 'data');
  header.setUint32(40, pcm.length, Endian.little);
  return Uint8List.fromList([...header.buffer.asUint8List(), ...pcm]);
}

class ConsentDialog extends StatefulWidget {
  final ChatController chat;
  final Json challenge;
  const ConsentDialog({super.key, required this.chat, required this.challenge});
  @override
  State<ConsentDialog> createState() => _ConsentDialogState();
}

class _ConsentDialogState extends State<ConsentDialog> {
  final password = TextEditingController(), ack = TextEditingController();
  bool busy = false;
  Object? error;
  Timer? timer;
  bool get expired =>
      DateTime.now().millisecondsSinceEpoch > widget.challenge['expiresAt'];
  @override
  void initState() {
    super.initState();
    timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    password.clear();
    password.dispose();
    ack.dispose();
    super.dispose();
  }

  Future<void> answer(bool approve) async {
    setState(() => busy = true);
    try {
      final c = widget.challenge;
      final values = <String, dynamic>{
        'decision': approve ? 'approve' : 'reject',
      };
      if (approve) {
        if (c['riskAcknowledgementText'] != null &&
            ack.text != c['riskAcknowledgementText']) {
          throw const ApiFailure('请完整抄录风险确认语句');
        }
        if (c['riskAcknowledgementText'] != null) {
          values['riskAcknowledgement'] = ack.text;
        }
        if (c['verification'] == 'payment-password') {
          if (!RegExp(r'^\d{6}$').hasMatch(password.text)) {
            throw const ApiFailure('请输入六位支付密码');
          }
          values['paymentPassword'] = password.text;
        } else if (c['verification'] == 'sms' || c['verification'] == 'face') {
          await widget.chat.session.bank.call(
            'api/security/verify',
            method: 'POST',
            body: {'channel': c['verification']},
          );
          values['customerVerification'] = {
            'method': c['verification'],
            'result': 'passed',
          };
        }
      }
      await widget.chat.answerConsent(values);
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      password.clear();
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.challenge;
    return PopScope(
      canPop: !busy,
      child: AlertDialog(
        title: const Text('确认操作'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final field in objects(c['fields']))
                pair('${field['label']}', '${field['value']}'),
              if (c['consequence'] != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Text(
                    '${c['consequence']}',
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
              if (c['riskAcknowledgementText'] != null) ...[
                Text('请完整抄录：${c['riskAcknowledgementText']}'),
                const SizedBox(height: 10),
                TextField(
                  controller: ack,
                  enabled: !busy,
                  decoration: const InputDecoration(labelText: '风险确认语句'),
                ),
              ],
              if (c['verification'] == 'payment-password')
                TextField(
                  controller: password,
                  enabled: !busy,
                  obscureText: true,
                  keyboardType: TextInputType.number,
                  enableSuggestions: false,
                  decoration: const InputDecoration(labelText: '支付密码'),
                ),
              if (expired) const Text('本次确认已过期'),
              if (error != null)
                Text(
                  '$error',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: busy ? null : () => answer(false),
            child: const Text('取消操作'),
          ),
          FilledButton(
            onPressed: busy || expired ? null : () => answer(true),
            child: Text(
              busy
                  ? '验证中…'
                  : c['verification'] == 'face'
                  ? '核验并确认'
                  : c['verification'] == 'sms'
                  ? '验证并确认'
                  : '确认',
            ),
          ),
        ],
      ),
    );
  }
}

class QuestionForm extends StatefulWidget {
  final ChatController chat;
  final Json question;
  const QuestionForm({super.key, required this.chat, required this.question});
  @override
  State<QuestionForm> createState() => _QuestionFormState();
}

class _QuestionFormState extends State<QuestionForm> {
  final selected = <String, Set<String>>{};
  late final custom = {
    for (final q in objects(widget.question['questions']))
      '${q['id']}': TextEditingController(),
  };
  bool busy = false;
  Object? error;
  @override
  void dispose() {
    for (final c in custom.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final questions = objects(widget.question['questions']);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            '补充信息',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 18),
          for (final q in questions)
            Padding(
              padding: const EdgeInsets.only(bottom: 18),
              child: Surface(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '${q['question']}',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    for (final option
                        in (q['options'] == null
                            ? <Json>[]
                            : objects(q['options'])))
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('${option['label']}'),
                        subtitle: option['description'] == null
                            ? null
                            : Text(
                                '${option['description']}',
                                style: const TextStyle(fontSize: 12),
                              ),
                        controlAffinity: ListTileControlAffinity.leading,
                        value:
                            selected['${q['id']}']?.contains(option['label']) ??
                            false,
                        onChanged: busy
                            ? null
                            : (v) => setState(() {
                                final key = '${q['id']}';
                                selected.putIfAbsent(key, () => {});
                                if (q['multiSelect'] != true) {
                                  selected[key]!.clear();
                                }
                                if (v == true) {
                                  selected[key]!.add('${option['label']}');
                                } else {
                                  selected[key]!.remove(option['label']);
                                }
                              }),
                      ),
                    TextField(
                      controller: custom['${q['id']}'],
                      enabled: !busy,
                      decoration: InputDecoration(
                        labelText: q['options'] == null ? '你的回答' : '补充回答（选填）',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (error != null) Text('$error'),
          FilledButton(
            onPressed: busy
                ? null
                : () async {
                    setState(() => busy = true);
                    try {
                      if (DateTime.now().millisecondsSinceEpoch >
                          widget.question['expiresAt']) {
                        throw const ApiFailure('问询已过期');
                      }
                      final values = <Json>[];
                      for (final q in questions) {
                        final id = '${q['id']}';
                        final choices = selected[id] ?? <String>{};
                        final text = custom[id]!.text.trim();
                        if (choices.isEmpty && text.isEmpty) {
                          throw const ApiFailure('请回答每个问题');
                        }
                        values.add({
                          'id': id,
                          'selected': choices.toList(),
                          if (text.isNotEmpty) 'custom': text,
                        });
                      }
                      await widget.chat.answerQuestion(values);
                      if (context.mounted) Navigator.pop(context);
                    } catch (e) {
                      if (mounted) setState(() => error = e);
                    } finally {
                      if (mounted) setState(() => busy = false);
                    }
                  },
            child: Text(busy ? '提交中…' : '提交回答'),
          ),
        ],
      ),
    );
  }
}
