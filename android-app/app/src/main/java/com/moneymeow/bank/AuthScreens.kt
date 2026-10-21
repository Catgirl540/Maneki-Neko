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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 登录与开户共用的骨架：顶部返回栏、可滚动内容、**底部固定主按钮**
 * （截图里「登入 / 下一步 / 完成开户」都贴底）。
 */
@Composable
private fun AuthScaffold(
    title: String,
    onBack: () -> Unit,
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
            content = content,
        )
        Column(
            Modifier
                .fillMaxWidth()
                .background(Tokens.Page)
                .padding(horizontal = 20.dp, vertical = 14.dp),
            content = footer,
        )
    }
}

/* ───────────────── 60 登录 ───────────────── */

@Composable
fun LoginScreen(
    onBack: () -> Unit,
    onLogin: () -> Unit,
    onRegister: () -> Unit,
) {
    var phone by remember { mutableStateOf("13800138000") }
    var password by remember { mutableStateOf("123456") }
    var smsCode by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var hint by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AuthScaffold(
        title = "登录",
        onBack = onBack,
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
                TextFieldRow(
                    label = "手机号",
                    value = phone,
                    onValueChange = { phone = it.filter(Char::isDigit).take(11) },
                    placeholder = "请输入手机号",
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Phone,
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
                TextFieldRow(
                    label = "短信验证码",
                    value = smsCode,
                    onValueChange = { smsCode = it.filter(Char::isDigit).take(6) },
                    placeholder = "6 位验证码",
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
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
                Text("忘记密码？", fontSize = 12.sp, color = Tokens.Muted)
            }
        },
    )
}

/* ───────────────── 61–64 开户四步 ───────────────── */

@Composable
private fun StepHeader(step: Int, title: String, lead: String) {
    Column(Modifier.padding(horizontal = 20.dp)) {
        Row(Modifier.padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("第 $step 步 / 共 4 步", fontSize = 11.sp, color = Tokens.Muted)
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

@Composable
fun OpenPhoneScreen(onBack: () -> Unit, onNext: () -> Unit) {
    AuthScaffold(
        title = "注册开户",
        onBack = onBack,
        content = {
            StepHeader(1, "先验证手机号", "这个号码会成为你的登录账号，也用于接收账户变动通知。")
            Column(Modifier.padding(horizontal = 20.dp)) {
                Field("手机号", "138 0013 8000")
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) { Field("短信验证码", "6 位验证码") }
                    Spacer(Modifier.size(8.dp))
                    Box(
                        Modifier
                            .height(46.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(Tokens.Surface)
                            .border(1.dp, Tokens.Border, RoundedCornerShape(8.dp))
                            .padding(horizontal = 13.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("获取验证码", fontSize = 12.5.sp, color = Tokens.Ink2) }
                }
            }
        },
        footer = { PrimaryButton("下一步", onNext) },
    )
}

@Composable
fun OpenRealNameScreen(onBack: () -> Unit, onNext: () -> Unit) {
    AuthScaffold(
        title = "实名信息",
        onBack = onBack,
        content = {
            StepHeader(2, "填写实名信息", "姓名与证件号需与本人证件一致，开户后不可自行修改。")
            Column(Modifier.padding(horizontal = 20.dp)) {
                Field("姓名", "陈嘉禾")
                Spacer(Modifier.height(14.dp))
                Field("身份证号", "3101**********1234", hint = "演示环境已自动填入示例证件号")
            }
        },
        footer = { PrimaryButton("下一步", onNext) },
    )
}

@Composable
fun OpenFaceScreen(onBack: () -> Unit, onNext: () -> Unit) {
    AuthScaffold(
        title = "身份核验",
        onBack = onBack,
        content = {
            StepHeader(3, "人脸核验", "把脸放进框内，按提示完成动作。核验只用于确认是本人开户。")
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
                            color = Tokens.Border,
                            style = androidx.compose.ui.graphics.drawscope.Stroke(
                                width = 1.dp.toPx(),
                                pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(
                                    floatArrayOf(5.dp.toPx(), 4.dp.toPx()),
                                ),
                            ),
                        )
                    }
                    Icon(Icons.Person, contentDescription = null, tint = Tokens.Muted, modifier = Modifier.size(52.dp))
                }
                Spacer(Modifier.height(14.dp))
                Text(
                    "光线充足时识别更快\n演示环境不会调用真实摄像头",
                    fontSize = 12.sp,
                    color = Tokens.Muted,
                    lineHeight = 19.sp,
                    textAlign = TextAlign.Center,
                )
            }
        },
        footer = { PrimaryButton("开始人脸核验", onNext) },
    )
}

@Composable
fun OpenPasswordScreen(onBack: () -> Unit, onDone: () -> Unit) {
    AuthScaffold(
        title = "设置支付密码",
        onBack = onBack,
        content = {
            StepHeader(4, "设置 6 位支付密码", "转账、办卡等敏感操作需要输入这个密码，请勿与登录密码相同。")
            Column(Modifier.padding(horizontal = 20.dp)) {
                Field("支付密码", "6 位数字", placeholder = true)
                Spacer(Modifier.height(14.dp))
                Field("确认支付密码", "再输一次", placeholder = true)
            }
        },
        footer = { PrimaryButton("完成开户", onDone) },
    )
}

@Composable
fun OpenDoneScreen(onBack: () -> Unit, onHome: () -> Unit) {
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
                Text("储蓄账户已开立，借记卡随后寄出", fontSize = 12.5.sp, color = Tokens.Muted)
            }
            KvCard(
                listOf(
                    "户名" to "陈嘉禾",
                    "账户号码" to "1024 ···· 8821",
                    "借记卡" to "尾号 8821 · 待签收",
                    "支付密码" to "已设置",
                ),
                Modifier.padding(horizontal = 14.dp),
            )
        }
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
        ) {
            PrimaryButton("进入首页", onHome)
        }
    }
}
