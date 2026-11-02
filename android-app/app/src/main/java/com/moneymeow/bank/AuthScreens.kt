package com.moneymeow.bank

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * 登录与开户共用的骨架：顶部返回栏、可滚动内容、**底部固定主按钮**
 * （截图里「登入 / 下一步 / 完成开户」都贴底）。
 */
@Composable
private fun AuthScaffold(
    title: String,
    onBack: (() -> Unit)? = null,
    footerInContent: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
    footer: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Page),
    ) {
        TopBar(title, onBack)
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
        ) {
            content()
            if (footerInContent) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 20.dp), content = footer)
            }
        }
        if (!footerInContent) {
            Column(
                Modifier.fillMaxWidth().background(Tokens.Page).padding(horizontal = 20.dp, vertical = 14.dp),
                content = footer,
            )
        }
    }
}

/* ───────────────── 60 登录 ───────────────── */

@Composable
fun LoginScreen(
    onBack: () -> Unit,
    onLogin: () -> Unit,
    onRegister: () -> Unit,
    root: Boolean = false,
) {
    // 仅调试包预填演示账号，正式包不携带默认凭据。
    var phone by remember { mutableStateOf(if (BuildConfig.DEBUG) "13800138000" else "") }
    var password by remember { mutableStateOf(if (BuildConfig.DEBUG) "123456" else "") }
    var smsCode by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var hint by remember { mutableStateOf<String?>(null) }
    var passwordHelp by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    // 登录页有密码框：开着防截屏，避免明文被截屏/录屏工具取走
    SecureWindow()

    AuthScaffold(
        title = "登录",
        onBack = if (root) null else onBack,
        footerInContent = true,
        content = {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Image(painterResource(R.drawable.brand_cat), null, Modifier.size(62.dp), contentScale = ContentScale.Fit)
                Spacer(Modifier.height(9.dp))
                Text("招财猫银行", fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            }
            Column(Modifier.padding(horizontal = 20.dp)) {
                SecureNumberField(
                    label = "手机号",
                    value = phone,
                    onValueChange = { phone = it.filter(Char::isDigit).take(11) },
                    placeholder = "请输入手机号",
                    maxLength = 11,
                )
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "登录密码",
                    value = password,
                    onValueChange = { password = it },
                    placeholder = "请输入登录密码",
                    password = true,
                )
                Spacer(Modifier.height(14.dp))
                SecureNumberField(
                    label = "短信验证码",
                    value = smsCode,
                    onValueChange = { smsCode = it.filter(Char::isDigit).take(6) },
                    placeholder = "6 位验证码",
                    maxLength = 6,
                    trailing = {
                        Box(
                            Modifier
                                .height(46.dp)
                                .clip(CircleShape)
                                .background(Tokens.Surface)
                                .border(1.dp, Tokens.Border, CircleShape)
                                .clickable(enabled = !sending) {
                                    if (phone.length < 11) {
                                        error = "请先输入 11 位手机号"
                                        return@clickable
                                    }
                                    sending = true
                                    error = null
                                    scope.launch {
                                        runCatching { BankApi.sendSmsCode(phone) }
                                            .onSuccess { demo ->
                                                hint = if (demo != null) "演示验证码：$demo" else "验证码已发送"
                                            }
                                            .onFailure { error = it.message }
                                        sending = false
                                    }
                                }
                                .padding(horizontal = 15.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                if (sending) "发送中…" else "获取验证码",
                                fontSize = 12.5.sp,
                                color = Tokens.Ink2,
                            )
                        }
                    },
                )
                if (hint != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(hint!!, fontSize = 11.sp, color = Tokens.Ink2)
                }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(error!!, fontSize = 11.sp, color = Tokens.Coral)
                }
            }
        },
        footer = {
            PrimaryButton(
                if (submitting) "登录中…" else "登入",
                onClick = {
                    if (submitting) return@PrimaryButton
                    error = null
                    submitting = true
                    scope.launch {
                        runCatching { BankApi.login(phone, password, smsCode) }
                            .onSuccess { result ->
                                SessionStore.save(result)
                                submitting = false
                                onLogin()
                            }
                            .onFailure {
                                error = it.message ?: "登录失败"
                                submitting = false
                            }
                    }
                },
            )
            Spacer(Modifier.height(18.dp))
            Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    "注册并开户",
                    fontSize = 12.sp,
                    color = Tokens.Ink,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.clickableNoRipple { onRegister() },
                )
                Text("忘记密码？", style = Tokens.Text.note, modifier = Modifier.clickableNoRipple { passwordHelp = !passwordHelp })
                if (passwordHelp) Text("当前演示版本暂不支持自助找回密码。", style = Tokens.Text.hint)
            }
        },
    )
}

/* ───────────────── 61–64 开户四步 ───────────────── */

@Composable
private fun StepHeader(step: Int, title: String, lead: String) {
    Column(Modifier.padding(horizontal = 20.dp)) {
        Row(Modifier.padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("第 $step 步 / 共 4 步", style = Tokens.Text.hint)
            Spacer(Modifier.size(10.dp))
            Box(
                Modifier
                    .weight(1f)
                    .height(3.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(Tokens.Border)
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(step / 4f)
                        .height(3.dp)
                        .background(Tokens.Primary)
                )
            }
        }
        Text(title, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
        Spacer(Modifier.height(6.dp))
        Text(lead, fontSize = 12.5.sp, color = Tokens.Muted, lineHeight = 20.sp)
        Spacer(Modifier.height(20.dp))
    }
}

/** 整个开户流程共享的草稿；只活在未登录流程内，不写入本地存储。 */
private class OpenAccountDraft {
    var phone by mutableStateOf("")
    var smsCode by mutableStateOf("")
    var loginPassword by mutableStateOf("")
    var confirmLoginPassword by mutableStateOf("")
    var holderName by mutableStateOf("")
    var idNumber by mutableStateOf("")
    var faceTicket by mutableStateOf("")
    var paymentPassword by mutableStateOf("")
    var confirmPaymentPassword by mutableStateOf("")
    var pledge by mutableStateOf(false)
}

private val PHONE_PATTERN = Regex("^1[3-9]\\d{9}$")
private val ID_PATTERN = Regex("^\\d{17}[\\dXx]$")

@Composable
private fun PhoneStep(draft: OpenAccountDraft, onBack: () -> Unit, onNext: () -> Unit) {
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var hint by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun sendCode() {
        if (sending) return
        if (!PHONE_PATTERN.matches(draft.phone)) {
            error = "请输入正确的 11 位手机号"
            return
        }
        sending = true
        error = null
        scope.launch {
            runCatching { BankApi.sendSmsCode(draft.phone) }
                .onSuccess { demo ->
                    hint = if (demo != null) "演示验证码：$demo" else "验证码已发送，请查看短信"
                }
                .onFailure { error = it.message }
            sending = false
        }
    }

    AuthScaffold(
        title = "注册开户",
        onBack = onBack,
        content = {
            StepHeader(1, "先验证手机号", "这个号码会成为你的登录账号，也用于接收账户变动通知。")
            Column(Modifier.padding(horizontal = 20.dp)) {
                SecureNumberField(
                    label = "手机号",
                    value = draft.phone,
                    onValueChange = { draft.phone = it.filter(Char::isDigit).take(11) },
                    placeholder = "请输入 11 位手机号",
                    maxLength = 11,
                )
                Spacer(Modifier.height(14.dp))
                SecureNumberField(
                    label = "短信验证码",
                    value = draft.smsCode,
                    onValueChange = { draft.smsCode = it.filter(Char::isDigit).take(6) },
                    placeholder = "6 位验证码",
                    maxLength = 6,
                    trailing = {
                        Box(
                            Modifier
                                .height(46.dp)
                                .clip(CircleShape)
                                .background(Tokens.Surface)
                                .border(1.dp, Tokens.Border, CircleShape)
                                .clickable(enabled = !sending) { sendCode() }
                                .padding(horizontal = 15.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(if (sending) "发送中…" else "获取验证码", fontSize = 12.5.sp, color = Tokens.Ink2)
                        }
                    },
                )
                if (hint != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(hint!!, fontSize = 11.sp, color = Tokens.Ink2)
                }
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "登录密码",
                    value = draft.loginPassword,
                    onValueChange = { draft.loginPassword = it },
                    placeholder = "设置登录密码",
                    password = true,
                )
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "确认登录密码",
                    value = draft.confirmLoginPassword,
                    onValueChange = { draft.confirmLoginPassword = it },
                    placeholder = "再输一次登录密码",
                    password = true,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    PasswordPolicy.requirements,
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                    lineHeight = 17.sp,
                )
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(error!!, fontSize = 11.5.sp, color = Tokens.Coral)
                }
            }
        },
        footer = {
            PrimaryButton("下一步", onClick = {
                error = null
                when {
                    !PHONE_PATTERN.matches(draft.phone) -> error = "请输入正确的 11 位手机号"
                    draft.smsCode.length != 6 -> error = "请输入 6 位短信验证码"
                    !PasswordPolicy.isValid(draft.loginPassword) -> error = PasswordPolicy.requirements
                    draft.loginPassword != draft.confirmLoginPassword -> error = "两次输入的登录密码不一致"
                    else -> onNext()
                }
            })
        },
    )
}

@Composable
private fun RealNameStep(draft: OpenAccountDraft, onBack: () -> Unit, onNext: () -> Unit) {
    var error by remember { mutableStateOf<String?>(null) }
    AuthScaffold(
        title = "实名信息",
        onBack = onBack,
        content = {
            StepHeader(2, "填写实名信息", "姓名与证件号需与本人证件一致，开户后不可自行修改。")
            Column(Modifier.padding(horizontal = 20.dp)) {
                TextFieldRow(
                    label = "姓名",
                    value = draft.holderName,
                    onValueChange = { draft.holderName = it.take(40) },
                    placeholder = "请输入真实姓名",
                )
                Spacer(Modifier.height(14.dp))
                TextFieldRow(
                    label = "身份证号",
                    value = draft.idNumber,
                    onValueChange = {
                        draft.idNumber = it.filter { ch -> ch.isDigit() || ch == 'X' || ch == 'x' }
                            .uppercase()
                            .take(18)
                    },
                    placeholder = "18 位身份证号",
                    keyboardType = KeyboardType.Ascii,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "证件信息仅用于本次开户核验，不写入本地存储。",
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                )
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(error!!, fontSize = 11.5.sp, color = Tokens.Coral)
                }
            }
        },
        footer = {
            PrimaryButton("下一步", onClick = {
                error = when {
                    draft.holderName.isBlank() -> "请填写姓名"
                    !ID_PATTERN.matches(draft.idNumber) -> "请输入 18 位身份证号"
                    else -> null
                }
                if (error == null) onNext()
            })
        },
    )
}

@Composable
private fun FaceStep(draft: OpenAccountDraft, onBack: () -> Unit, onNext: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val verified = draft.faceTicket.isNotEmpty()

    AuthScaffold(
        title = "身份核验",
        onBack = onBack,
        content = {
            StepHeader(3, "人脸核验", "核验结果只用于确认是本人开户。票证 5 分钟内有效。")
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier
                        .size(148.dp)
                        .clip(CircleShape)
                        .background(Tokens.SurfaceWarm),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                        drawCircle(
                            color = if (verified) Tokens.Primary else Tokens.Border,
                            style = androidx.compose.ui.graphics.drawscope.Stroke(
                                width = 1.dp.toPx(),
                                pathEffect = if (verified) null else androidx.compose.ui.graphics.PathEffect.dashPathEffect(
                                    floatArrayOf(5.dp.toPx(), 4.dp.toPx()),
                                ),
                            ),
                        )
                    }
                    Icon(
                        if (verified) Icons.Check else Icons.Person,
                        contentDescription = null,
                        tint = if (verified) Tokens.Primary else Tokens.Muted,
                        modifier = Modifier.size(52.dp),
                    )
                }
                Spacer(Modifier.height(14.dp))
                Text(
                    if (verified) "身份核验已通过" else "演示环境通过银行核身接口签发人脸票据，不调用摄像头",
                    fontSize = 12.sp,
                    color = if (verified) Tokens.Ink2 else Tokens.Muted,
                    lineHeight = 19.sp,
                    textAlign = TextAlign.Center,
                )
                if (error != null) {
                    Spacer(Modifier.height(10.dp))
                    Text(error!!, fontSize = 11.5.sp, color = Tokens.Coral)
                }
            }
        },
        footer = {
            PrimaryButton(
                when {
                    busy -> "核验中…"
                    verified -> "下一步"
                    else -> "开始人脸核验"
                },
                onClick = {
                    if (busy) return@PrimaryButton
                    if (verified) {
                        onNext()
                        return@PrimaryButton
                    }
                    busy = true
                    error = null
                    scope.launch {
                        runCatching { BankApi.verifyIdentity("face") }
                            .onSuccess { draft.faceTicket = it }
                            .onFailure { error = it.message ?: "人脸核验失败，请重试" }
                        busy = false
                    }
                },
            )
        },
    )
}

@Composable
private fun PasswordStep(
    draft: OpenAccountDraft,
    onBack: () -> Unit,
    onDone: (RegistrationResultDto) -> Unit,
    onRestart: () -> Unit,
) {
    var error by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    var hint by remember { mutableStateOf<String?>(null) }
    val submitter = rememberSubmitter()

    fun submit() {
        error = when {
            !Regex("^\\d{6}$").matches(draft.paymentPassword) -> "请设置 6 位数字支付密码"
            draft.paymentPassword != draft.confirmPaymentPassword -> "两次输入的支付密码不一致"
            !draft.pledge -> "请阅读并确认合法开立和使用账户承诺"
            else -> null
        }
        if (error != null) return
        var created: RegistrationResultDto? = null
        submitter.submit(
            fallback = "开户失败，请稍后重试",
            onStart = { failed = false },
            onError = { error = it; failed = true },
            onFailure = { throwable ->
                if ((throwable as? BankApiException)?.code == "BAD_PAY_PASSWORD") {
                    draft.paymentPassword = ""
                    draft.confirmPaymentPassword = ""
                }
            },
            // 注册成功后再跳转，避免请求失败时离开当前步骤。
            onSuccess = { created?.let { onDone(it) } },
        ) {
            val result = BankApi.register(
                phone = draft.phone,
                password = draft.loginPassword,
                paymentPassword = draft.paymentPassword,
                holderName = draft.holderName.trim(),
                idNumber = draft.idNumber,
                smsCode = draft.smsCode,
                faceTicket = draft.faceTicket,
                pledge = ACCOUNT_OPENING_PLEDGE,
            )
            SessionStore.save(LoginResult(result.token, result.name, result.phone))
            created = result
        }
    }

    AuthScaffold(
        title = "设置支付密码",
        onBack = onBack,
        content = {
            StepHeader(4, "设置 6 位支付密码", "转账、办卡等敏感操作需要输入这个密码，请勿与登录密码相同。")
            Column(Modifier.padding(horizontal = 20.dp)) {
                SecurePinField(
                    label = "支付密码",
                    value = draft.paymentPassword,
                    onValueChange = { draft.paymentPassword = it.filter(Char::isDigit).take(6) },
                )
                Spacer(Modifier.height(14.dp))
                SecurePinField(
                    label = "确认支付密码",
                    value = draft.confirmPaymentPassword,
                    onValueChange = { draft.confirmPaymentPassword = it.filter(Char::isDigit).take(6) },
                    placeholder = "再输一次",
                )
                Spacer(Modifier.height(18.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Tokens.SurfaceWarm)
                        .padding(12.dp),
                ) {
                    Column {
                        Text(
                            ACCOUNT_MISUSE_PENALTY,
                            fontSize = 11.sp,
                            color = Tokens.Coral,
                            lineHeight = 17.sp,
                        )
                        Spacer(Modifier.height(10.dp))
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickableNoRipple { draft.pledge = !draft.pledge },
                            verticalAlignment = Alignment.Top,
                        ) {
                            Box(
                                Modifier
                                    .padding(top = 1.dp)
                                    .size(20.dp)
                                    .clip(CircleShape)
                                    .background(if (draft.pledge) Tokens.Primary else Tokens.Surface)
                                    .border(1.dp, if (draft.pledge) Tokens.Primary else Tokens.Border, CircleShape),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (draft.pledge) Text("✓", fontSize = 11.sp, color = Color.White)
                            }
                            Spacer(Modifier.size(8.dp))
                            Text(
                                ACCOUNT_OPENING_PLEDGE,
                                fontSize = 11.5.sp,
                                color = Tokens.Ink2,
                                lineHeight = 18.sp,
                            )
                        }
                    }
                }
                if (error != null) {
                    Spacer(Modifier.height(10.dp))
                    Text(error!!, fontSize = 11.5.sp, color = Tokens.Coral, lineHeight = 18.sp)
                }
                if (failed) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "验证码已失效或已被使用？返回第 1 步重新获取验证码，并重新完成人脸核验。",
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                        lineHeight = 17.sp,
                    )
                    Spacer(Modifier.height(8.dp))
                    GhostButton("重新验证并获取验证码", onRestart)
                }
                if (hint != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(hint!!, style = Tokens.Text.hint)
                }
            }
        },
        footer = {
            PrimaryButton(if (submitter.busy) "开户中…" else "完成开户", onClick = { submit() })
        },
    )
}

@Composable
fun OpenDoneScreen(
    onBack: (() -> Unit)? = null,
    onHome: () -> Unit,
    result: RegistrationResultDto? = null,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Page),
    ) {
        TopBar("开户完成", onBack)
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
        ) {
            if (result == null) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("没有可展示的开户结果", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "请返回登录页，从「注册并开户」重新进入。",
                        fontSize = 12.5.sp,
                        color = Tokens.Muted,
                        textAlign = TextAlign.Center,
                    )
                }
            } else {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 26.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier
                            .size(62.dp)
                            .clip(CircleShape)
                            .background(Tokens.Primary),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(28.dp))
                    }
                    Spacer(Modifier.height(14.dp))
                    Text("开户成功", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        (result.accountLabel.ifEmpty { "储蓄账户" }) + "已开立，登录状态已建立",
                        fontSize = 12.5.sp,
                        color = Tokens.Muted,
                    )
                }
                KvCard(
                    listOf(
                        "户名" to result.name,
                        "账户号码" to result.accountNo,
                        "账户类型" to result.accountLabel.ifEmpty { "储蓄账户" },
                        "开户时间" to formatDateTime(result.openedAt),
                        "支付密码" to "已设置",
                    ),
                    Modifier.padding(horizontal = 14.dp),
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    "借记卡需在「银行卡」中另行申请，本页不展示尚未发生的卡片状态。",
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                    modifier = Modifier.padding(horizontal = 18.dp),
                    lineHeight = 17.sp,
                )
            }
        }
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
        ) {
            PrimaryButton(if (result == null) "返回登录页" else "进入首页", result?.let { onHome } ?: (onBack ?: onHome))
        }
    }
}

/* ───────────────── 旧路由占位（保持 MainActivity 编译） ───────────────── */

/**
 * 开户流程现在由 [AuthGate] 在未登录根流程内一次持有全部草稿；
 * 老的四段独立路由无法跨路由保存手机号 / 验证码 / 人脸票据，继续展示表单会误导用户。
 * 这里明确提示从登录页重新进入，避免再从零散路由伪造成功。
 */
@Composable
private fun LegacyOpenAccountNotice(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Tokens.Page)) {
        TopBar("注册开户", onBack)
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 24.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("请从登录页进入开户", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
            Spacer(Modifier.height(10.dp))
            Text(
                "开户需要连续完成手机号、实名、人脸核验和支付密码四步；请返回登录页，点击「注册并开户」。",
                fontSize = 12.5.sp,
                color = Tokens.Muted,
                textAlign = TextAlign.Center,
                lineHeight = 20.sp,
            )
            Spacer(Modifier.height(22.dp))
            PrimaryButton("返回登录页", onBack)
        }
    }
}

@Composable
fun OpenPhoneScreen(onBack: () -> Unit) {
    LegacyOpenAccountNotice(onBack)
}

@Composable
fun OpenRealNameScreen(onBack: () -> Unit) {
    LegacyOpenAccountNotice(onBack)
}

@Composable
fun OpenFaceScreen(onBack: () -> Unit) {
    LegacyOpenAccountNotice(onBack)
}

@Composable
fun OpenPasswordScreen(onBack: () -> Unit) {
    LegacyOpenAccountNotice(onBack)
}

/* ───────────────── 未登录根流程 ───────────────── */

private enum class AuthRoute { Login, Phone, RealName, Face, Password, Done }

/**
 * 未登录时的唯一入口：登录页 + 开户四步，全部在这一层内切换。
 * 草稿只保存在内存里；提交成功后保存真实令牌，并由「开户完成」页展示服务端返回的账户信息。
 */
@Composable
fun AuthGate(onLoggedIn: () -> Unit) {
    var route by remember { mutableStateOf(AuthRoute.Login) }
    var draft by remember { mutableStateOf(OpenAccountDraft()) }
    var result by remember { mutableStateOf<RegistrationResultDto?>(null) }

    // 根页面不在 Scaffold 内，需要自己让开状态栏与导航条。
    Box(
        Modifier
            .fillMaxSize()
            .background(Tokens.Page)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        when (route) {
            AuthRoute.Login -> LoginScreen(
                root = true,
                onBack = {},
                onLogin = onLoggedIn,
                onRegister = {
                    draft = OpenAccountDraft()
                    result = null
                    route = AuthRoute.Phone
                },
            )
            AuthRoute.Phone -> PhoneStep(
                draft = draft,
                onBack = { route = AuthRoute.Login },
                onNext = { route = AuthRoute.RealName },
            )
            AuthRoute.RealName -> RealNameStep(
                draft = draft,
                onBack = { route = AuthRoute.Phone },
                onNext = { route = AuthRoute.Face },
            )
            AuthRoute.Face -> FaceStep(
                draft = draft,
                onBack = { route = AuthRoute.RealName },
                onNext = { route = AuthRoute.Password },
            )
            AuthRoute.Password -> PasswordStep(
                draft = draft,
                onBack = { route = AuthRoute.Face },
                onDone = {
                    result = it
                    route = AuthRoute.Done
                },
                onRestart = {
                    // 人脸票据与短信挑战都已被服务端消费，重来必须重新获取。
                    draft.faceTicket = ""
                    draft.smsCode = ""
                    route = AuthRoute.Phone
                },
            )
            AuthRoute.Done -> OpenDoneScreen(
                onBack = onLoggedIn,
                onHome = onLoggedIn,
                result = result,
            )
        }
    }
}
