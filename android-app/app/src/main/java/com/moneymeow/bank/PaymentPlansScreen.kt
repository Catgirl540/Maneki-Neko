package com.moneymeow.bank

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.activity.compose.BackHandler
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray
import java.math.BigDecimal
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

private fun planAmount(value: String): Long = runCatching {
    require(value.matches(Regex("[0-9]+(\\.[0-9]{1,2})?")))
    BigDecimal(value).movePointRight(2).longValueExact().also { require(it > 0) }
}.getOrElse { throw IllegalArgumentException("请输入有效金额，最多两位小数") }

private data class ExpenseDraft(val title: String = "", val amount: String = "", val names: String = "")
private fun splitNames(value: String) = value.split(',', '，', '\n').map { it.trim() }
internal fun scheduledIso(value: String): String = LocalDateTime.parse(value, DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm").withResolverStyle(java.time.format.ResolverStyle.STRICT)).atZone(ZoneId.of("Asia/Shanghai")).toInstant().toString()
private fun planStatus(status: String) = mapOf("scheduled" to "待执行", "executed" to "已执行", "failed" to "执行失败", "cancelled" to "已取消", "open" to "待收款", "complete" to "已收齐", "unpaid" to "待付款", "processing" to "付款处理中", "paid" to "已付款")[status] ?: "状态待核查"

/**
 * 成员身份归类，与提交校验同一套正则：11 位按手机号，12–19 位按本行账号。
 * 只用于界面提示（键盘类型、占位文案、状态小字），不改变提交逻辑。
 */
private enum class MemberIdentity { Empty, Partial, Phone, Account, Invalid }

private fun classifyIdentity(raw: String): MemberIdentity {
    val value = raw.trim()
    return when {
        value.isEmpty() -> MemberIdentity.Empty
        value.matches(Regex("1[3-9][0-9]{9}")) -> MemberIdentity.Phone
        value.matches(Regex("\\d{12,19}")) -> MemberIdentity.Account
        // 纯数字且还没到最终长度：继续输入中，不算错。
        value.all(Char::isDigit) && value.length < 19 -> MemberIdentity.Partial
        else -> MemberIdentity.Invalid
    }
}

private const val MEMBER_NAME_MAX = 40
private const val MEMBER_IDENTITY_MAX = 19
private const val MEMBER_MEMO_MAX = 140

/** 表格里的一位参与人（草稿）。`error` 只做界面提示，提交仍以原有校验为准。 */
private data class AaMemberDraft(
    val id: String = UUID.randomUUID().toString(),
    val name: String = "",
    val identity: String = "",
    val amount: String = "",
    val memo: String = "",
    val expanded: Boolean = false,
    /** 手机号 / 本行账号 的输入提示与键盘类型偏好，仅影响界面，不影响提交。 */
    val accountMode: Boolean = false,
) {
    val error: String?
        get() {
            if (name.isBlank()) return "请填写成员姓名"
            if (classifyIdentity(identity) !in listOf(MemberIdentity.Phone, MemberIdentity.Account)) return "请填写手机号或 12–19 位本行账号"
            if (amount.isNotBlank() && runCatching { planAmount(amount) }.isFailure) return "应付金额最多两位小数"
            return null
        }
}

/**
 * 按分配结果对齐草稿：原有姓名/身份/备注按成员姓名沿用；人数变化时新增行默认取分配姓名。
 *
 * 应付金额每次都按分配结果回填（编辑金额不会影响分摊），所以这里只回填可编辑的字符串金额，
 * 不带 ¥ 符号和千分位。只在分配结果变化时调用，不能在重组里调用，否则会覆盖正在输入的内容。
 */
private fun syncMemberDrafts(previous: List<AaMemberDraft>, participants: List<Pair<String, Long>>): List<AaMemberDraft> {
    if (participants.isEmpty()) return previous
    val unused = previous.toMutableList()
    return participants.map { (participant, share) ->
        val index = unused.indexOfFirst { it.name.trim() == participant }
        val base = if (index >= 0) unused.removeAt(index) else AaMemberDraft(name = participant)
        base.copy(amount = "%d.%02d".format(share / 100, share % 100))
    }
}


// 表格列宽：在 360dp（页面左右各 14dp → 内容 332dp）下也能放下三列而不横向滚动；
// 宽屏（430dp+）只是留白变多，不会出现挤压变形。
// 姓名列 = 序号 20 + 间距 6 + 姓名格（80）；金额列 84；身份列吃掉剩余约 154dp。
private val MemberNameWidth: Dp = 106.dp
private val MemberAmountWidth: Dp = 84.dp
private val MemberRowPadding: Dp = 12.dp
private val MemberContentStart: Dp = 38.dp

private val tableHeaderStyle = TextStyle(fontSize = 11.sp, color = Tokens.Muted, fontWeight = FontWeight.Medium, letterSpacing = 0.3.sp)
private val tableValueStyle = TextStyle(fontSize = 14.sp, color = Tokens.Ink)
private val amountStyle = TextStyle(fontSize = 15.sp, color = Tokens.Ink, fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum")

/**
 * 表格里的一格输入：去掉每格描边，只在聚焦时给一层浅底 + 细描边。
 *
 * 姓名/备注是文字，用系统键盘（[keyboardType] 仍可指定）；
 * 金额/账号/手机号**不经过这里**，由调用方改用自绘安全键盘（见 [AaAmountCell]）。
 * 每格上方带一行小标签，保证表头在滚动后仍能看懂每个格子是什么。
 */
@Composable
private fun TableCellInput(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    textAlign: TextAlign = TextAlign.Start,
    textStyle: TextStyle = tableValueStyle,
    enabled: Boolean = true,
    trailing: (@Composable () -> Unit)? = null,
    footnote: String? = null,
    footnoteError: Boolean = false,
) {
    var focused by remember { mutableStateOf(false) }
    Column(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (focused) Tokens.SurfaceWarm else Color.Transparent)
            .padding(horizontal = 8.dp, vertical = 6.dp)
            .semantics { contentDescription = label },
    ) {
        Text(label, style = tableHeaderStyle.copy(fontSize = 10.sp), maxLines = 1)
        Spacer(Modifier.height(3.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                singleLine = true,
                textStyle = textStyle.copy(textAlign = textAlign),
                cursorBrush = SolidColor(Tokens.Accent),
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
                modifier = Modifier
                    .weight(1f)
                    .onFocusChanged { focused = it.isFocused },
                decorationBox = { inner ->
                    Box(contentAlignment = if (textAlign == TextAlign.End) Alignment.CenterEnd else Alignment.CenterStart) {
                        if (value.isEmpty()) {
                            Text(
                                text = placeholder,
                                fontSize = 13.sp,
                                color = Tokens.Muted,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                textAlign = textAlign,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        inner()
                    }
                },
            )
            if (trailing != null) {
                Spacer(Modifier.width(4.dp))
                trailing()
            }
        }
        if (footnote != null) {
            Spacer(Modifier.height(1.dp))
            Text(
                footnote,
                fontSize = 10.sp,
                color = if (footnoteError) Tokens.Coral else Tokens.Muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * 金额格：显示用等宽数字 + 右对齐；点开是自绘安全键盘（项目规范：金额一律走 [SecureNumberPadDialog]）。
 *
 * 只在输入框里敲金额，不另外渲染 [SecureNumberField] 自带的外框，避免表格里再叠一层描边控件。
 */
@Composable
private fun AaAmountCell(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "0.00",
    enabled: Boolean = true,
) {
    var open by remember { mutableStateOf(false) }
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    Column(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (open) Tokens.SurfaceWarm else Color.Transparent)
            .clickable(enabled = enabled, role = Role.Button) { focus.clearFocus(); open = true }
            .padding(horizontal = 8.dp, vertical = 6.dp)
            .semantics { contentDescription = label },
    ) {
        Text(label, style = tableHeaderStyle.copy(fontSize = 10.sp), maxLines = 1, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.End)
        Spacer(Modifier.height(3.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = value.ifEmpty { placeholder },
                style = if (value.isEmpty()) amountStyle.copy(color = Tokens.Muted, fontWeight = FontWeight.Normal) else amountStyle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.End,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(2.dp))
            Text("元", fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.alpha(if (value.isEmpty()) 0.6f else 1f))
        }
    }
    if (open && enabled) {
        // 与旧版 SecureNumberField 的金额格保持一致：maxLength = 16、不填小数位上限。
        SecureNumberPadDialog(
            title = "修改应付金额",
            subtitle = "安全键盘输入，最多两位小数",
            value = value,
            maxLength = 16,
            masked = false,
            allowDecimal = true,
            shuffle = false,
            onValueChange = onValueChange,
            onDismiss = { open = false },
        )
    }
}

/**
 * AA 参与人明细表：表头 + 每位参与人一行，行内展开可改付款备注。
 *
 * 列布局（三列，不横向滚动）：
 * - 姓名（定宽，可编辑，须与账户户名一致）
 * - 手机号或本行账号（占满剩余宽度，手机号 / 本行账号二者填一个即可）
 * - 应付金额（定宽 + 等宽数字，右对齐）
 * 在 360dp 宽度下表格仍能完整显示；备注与「身份校验」结果放在点开的行内第二行，
 * 避免四列挤压 + 横滑时看不到金额的问题。
 */
@Composable
private fun AaMemberTable(
    participants: List<Pair<String, Long>>,
    members: List<AaMemberDraft>,
    title: String,
    total: Long,
    selfAmount: Long?,
    enabled: Boolean,
    onChange: ((AaMemberDraft) -> AaMemberDraft) -> Unit,
) {
    val allComplete = members.isNotEmpty() && members.all { it.error == null }
    // 收款事由留空时表格标题会带上这个占位文案，这里据此给出不同的空态提示。
    val titleMissing = title == "未填写收款事由"
    HairlineCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(vertical = 4.dp)) {
            // 卡片标题区：标题 + 合计，右侧状态徽章给出「还差几条」。
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("参与人", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Text("$title · 共 ${members.size} 人", fontSize = 11.sp, color = Tokens.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        formatCents(total, "CNY"),
                        style = amountStyle.copy(fontSize = 16.sp),
                        maxLines = 1,
                    )
                    if (selfAmount != null) Text("本人份额 ${formatCents(selfAmount, "CNY")}", fontSize = 10.5.sp, color = Tokens.Muted)
                }
            }
            HorizontalDivider(color = Tokens.Border)
            // 表头：小字 + onSurfaceVariant 级别的灰，靠字重区分层级而不是加底色块。
            Row(
                Modifier.fillMaxWidth().background(Tokens.SurfaceWarm).padding(horizontal = MemberRowPadding, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("姓名", style = tableHeaderStyle, modifier = Modifier.width(MemberNameWidth))
                Text("手机号或本行账号", style = tableHeaderStyle, modifier = Modifier.weight(1f).padding(start = 8.dp))
                Text("应付金额", style = tableHeaderStyle, modifier = Modifier.width(MemberAmountWidth), textAlign = TextAlign.End)
            }
            HorizontalDivider(color = Tokens.Border)
            if (members.isEmpty()) {
                // 参与人还没填全时表格没有行：给出可执行的下一步，而不是空白卡片。
                Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(if (titleMissing) "先填写收款事由和参与人" else "先填写参与人姓名", fontSize = 13.sp, color = Tokens.Ink2)
                    Text(
                        if (titleMissing) "填好上方信息后，每位参与人会在这里按分摊结果生成一行。"
                        else "均分模式按「参与者姓名」生成行；分项模式按各消费的参加者汇总。",
                        fontSize = 11.sp,
                        lineHeight = 16.sp,
                        color = Tokens.Muted,
                    )
                }
            }
            members.forEachIndexed { index, member ->
                val incomplete = member.error != null
                AaMemberRow(
                    index = index,
                    member = member,
                    share = participants.getOrNull(index)?.second ?: 0L,
                    enabled = enabled,
                    incomplete = incomplete,
                    memoExpanded = member.expanded || member.memo.isNotBlank(),
                    onChange = { transform -> onChange { current -> if (current.id == member.id) transform(current) else current } },
                )
                if (index != members.lastIndex) HorizontalDivider(Modifier.padding(start = MemberRowPadding), color = Tokens.Border.copy(alpha = 0.7f))
            }
            if (members.isNotEmpty()) {
                HorizontalDivider(color = Tokens.Border)
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        if (allComplete) "全部成员信息已就绪" else "还有 ${members.count { it.error != null }} 位成员待补全",
                        fontSize = 11.sp,
                        color = if (allComplete) Tokens.Ink2 else Tokens.Muted,
                        modifier = Modifier.weight(1f),
                    )
                    Text("合计", fontSize = 11.sp, color = Tokens.Muted)
                    Spacer(Modifier.width(6.dp))
                    Text(formatCents(total, "CNY"), style = amountStyle.copy(fontSize = 13.sp), maxLines = 1)
                }
            }
        }
    }
}

/** 身份格下方的即时提示：只在手机号/账号这列出现，说明当前填的内容会被当作哪种身份。 */
private fun identityHint(value: String, accountMode: Boolean): String = when (classifyIdentity(value)) {
    MemberIdentity.Phone -> "按手机号收款"
    MemberIdentity.Account -> "按本行账号收款"
    MemberIdentity.Empty -> if (accountMode) "需 12–19 位" else "二者填一个即可"
    MemberIdentity.Partial -> if (accountMode) "账号 ${value.length} 位" else "手机号 ${value.length}/11 位"
    MemberIdentity.Invalid -> "格式无效"
}

/** 表格里的一行：主行三列 + 第二行付款备注（默认收起、点开编辑）。 */
@Composable
private fun AaMemberRow(
    index: Int,
    member: AaMemberDraft,
    share: Long,
    enabled: Boolean,
    incomplete: Boolean,
    memoExpanded: Boolean,
    onChange: ((AaMemberDraft) -> AaMemberDraft) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = MemberRowPadding, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Row(Modifier.width(MemberNameWidth), verticalAlignment = Alignment.CenterVertically) {
                // 序号 + 状态点：待补全的行用珊瑚色点提醒，但不再套一层红框。
                Box(
                    Modifier
                        .size(20.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (incomplete) Tokens.Coral.copy(alpha = 0.08f) else Tokens.SurfaceWarm),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("${index + 1}", fontSize = 10.5.sp, color = if (incomplete) Tokens.Coral else Tokens.Muted, fontWeight = FontWeight.Medium)
                }
                Spacer(Modifier.width(6.dp))
                TableCellInput(
                    label = "姓名",
                    value = member.name,
                    onValueChange = { raw -> onChange { it.copy(name = raw.take(MEMBER_NAME_MAX)) } },
                    placeholder = "户名",
                    keyboardType = KeyboardType.Text,
                    enabled = enabled,
                    modifier = Modifier.weight(1f),
                )
            }
            TableCellInput(
                label = "手机号或本行账号",
                value = member.identity,
                onValueChange = { raw -> onChange { it.copy(identity = raw.filter(Char::isDigit).take(MEMBER_IDENTITY_MAX)) } },
                placeholder = if (member.accountMode) "12–19 位账号" else "手机号或账号",
                keyboardType = if (member.accountMode) KeyboardType.Number else KeyboardType.Phone,
                enabled = enabled,
                modifier = Modifier.weight(1f).padding(start = 6.dp),
                trailing = {
                    // 只切换输入提示与键盘类型；手机号 / 账号填一个即可，判定始终按数字长度走。
                    Text(
                        if (member.accountMode) "账号" else "手机号",
                        fontSize = 10.sp,
                        color = Tokens.Ink2,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(Tokens.SurfaceWarm)
                            .clickable(enabled = enabled) { onChange { it.copy(accountMode = !it.accountMode) } }
                            .padding(horizontal = 5.dp, vertical = 2.dp),
                    )
                },
                footnote = identityHint(member.identity, member.accountMode),
                footnoteError = classifyIdentity(member.identity) == MemberIdentity.Invalid,
            )
            AaAmountCell(
                label = "应付金额",
                value = member.amount,
                onValueChange = { raw -> onChange { it.copy(amount = raw) } },
                enabled = enabled,
                modifier = Modifier.width(MemberAmountWidth).padding(start = 6.dp),
            )
        }
        if (memoExpanded) {
            HorizontalDivider(Modifier.padding(start = MemberContentStart, top = 2.dp, bottom = 2.dp), color = Tokens.Border.copy(alpha = 0.7f))
            TableCellInput(
                label = "付款备注",
                value = member.memo,
                onValueChange = { raw -> onChange { it.copy(memo = raw.take(MEMBER_MEMO_MAX)) } },
                placeholder = "留空则使用收款事由",
                enabled = enabled,
                modifier = Modifier.padding(start = MemberContentStart - MemberRowPadding).fillMaxWidth(),
                trailing = {
                    Text(
                        "收起",
                        fontSize = 10.sp,
                        color = Tokens.Muted,
                        modifier = Modifier
                            .clickable(enabled = enabled) { onChange { it.copy(expanded = false, memo = it.memo) } }
                            .padding(horizontal = 4.dp, vertical = 2.dp),
                    )
                },
            )
        } else {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = MemberContentStart, top = 2.dp)
                    .clickable(enabled = enabled) { onChange { it.copy(expanded = true) } }
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("备注", style = tableHeaderStyle.copy(fontSize = 10.sp))
                Spacer(Modifier.width(8.dp))
                Text("留空则使用收款事由", fontSize = 12.sp, color = Tokens.Muted, maxLines = 1, modifier = Modifier.weight(1f))
                Icon(Icons.Chevron, null, tint = Tokens.Muted, modifier = Modifier.size(14.dp).alpha(0.7f))
            }
        }
        member.error?.let { ErrorNote(it, Modifier.padding(start = MemberContentStart, top = 2.dp, bottom = 4.dp)) }
    }
}


/**
 * 下拉选择一行：标签 + 当前值 + 右侧箭头，点开是 Material3 的 DropdownMenu。
 *
 * 用作「本人完整姓名」——AA 分项模式里本人必须出现在某项参加者中，从已填参加者里选
 * 既不会打错字，也顺便提示了可选的取值范围。
 */
@Composable
private fun DropdownRow(
    label: String,
    value: String,
    options: List<String>,
    enabled: Boolean,
    onChange: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, fontSize = 12.sp, color = Tokens.Ink2)
        Box {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .border(1.dp, Tokens.Border, RoundedCornerShape(8.dp))
                    .clickable(enabled = enabled) { expanded = true }
                    .padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    value.ifBlank { "在下方参加者中选择本人" },
                    fontSize = 14.sp,
                    color = if (value.isBlank()) Tokens.Muted else Tokens.Ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Icon(Icons.Chevron, null, tint = Tokens.Muted, modifier = Modifier.size(16.dp))
            }
            androidx.compose.material3.DropdownMenu(expanded, { expanded = false }, Modifier.heightIn(max = 320.dp)) {
                options.forEach { option ->
                    androidx.compose.material3.DropdownMenuItem(
                        text = { Text(option) },
                        onClick = { onChange(option); expanded = false },
                    )
                }
            }
        }
    }
}

/** 表头行：小字 + 浅底，与表格行用发丝线分开。列宽由调用方给出，三张表共用同一套约定。 */
@Composable
private fun TableHeadRow(cells: List<Pair<String, Modifier>>) {
    Row(
        Modifier.fillMaxWidth().background(Tokens.SurfaceWarm).padding(horizontal = MemberRowPadding, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        cells.forEach { (label, modifier) -> Text(label, style = tableHeaderStyle, maxLines = 1, modifier = modifier) }
    }
}

/**
 * 分项 AA 的消费明细表：每行一项消费（事由 / 全额 / 参加者）。
 *
 * 取代原来"每项消费堆三个大输入框 + 一个删除按钮"的竖排表单。金额走自绘安全键盘，
 * 事由与参加者是文字，用系统键盘。参加者用逗号分隔写在一格，与网页端保持一致。
 */
@Composable
private fun ExpenseTable(
    expenses: List<ExpenseDraft>,
    enabled: Boolean,
    onChange: (index: Int, ExpenseDraft) -> Unit,
    onRemove: (index: Int) -> Unit,
    onAdd: () -> Unit,
) {
    val indexWidth = 30.dp
    val titleWidth = 108.dp
    val amountWidth = 92.dp
    HairlineCard(Modifier.fillMaxWidth()) {
        Column {
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("消费明细", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Text("每项独立均摊，再汇总每人应付并扣除本人份额", fontSize = 11.sp, color = Tokens.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            HorizontalDivider(color = Tokens.Border)
            TableHeadRow(
                listOf(
                    "序" to Modifier.width(indexWidth),
                    "消费事由" to Modifier.width(titleWidth),
                    "全额（元）" to Modifier.width(amountWidth),
                    "参加者（含本人）" to Modifier.weight(1f).padding(start = 8.dp),
                ),
            )
            HorizontalDivider(color = Tokens.Border)
            expenses.forEachIndexed { index, expense ->
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = MemberRowPadding, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${index + 1}", fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.width(indexWidth))
                    TableCellInput(
                        label = "消费事由",
                        value = expense.title,
                        onValueChange = { onChange(index, expense.copy(title = it.take(80))) },
                        placeholder = "聚餐、打车…",
                        enabled = enabled,
                        modifier = Modifier.width(titleWidth),
                    )
                    Box(Modifier.width(amountWidth).padding(start = 6.dp)) {
                        AaAmountCell(
                            label = "全额",
                            value = expense.amount,
                            onValueChange = { onChange(index, expense.copy(amount = it)) },
                            enabled = enabled,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    TableCellInput(
                        label = "参加者",
                        value = expense.names,
                        onValueChange = { onChange(index, expense.copy(names = it.take(500))) },
                        placeholder = "逗号分隔",
                        enabled = enabled,
                        modifier = Modifier.weight(1f).padding(start = 6.dp),
                    )
                    if (expenses.size > 1) {
                        Text(
                            "删",
                            fontSize = 11.sp,
                            color = Tokens.Coral,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .clickable(enabled = enabled) { onRemove(index) }
                                .padding(horizontal = 6.dp, vertical = 4.dp),
                        )
                    }
                }
                if (index != expenses.lastIndex) HorizontalDivider(Modifier.padding(start = MemberRowPadding), color = Tokens.Border.copy(alpha = 0.7f))
            }
            HorizontalDivider(color = Tokens.Border)
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "添加消费",
                    fontSize = 12.sp,
                    color = if (enabled && expenses.size < 30) Tokens.Ink2 else Tokens.Muted,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable(enabled = enabled && expenses.size < 30) { onAdd() }
                        .padding(horizontal = 6.dp, vertical = 4.dp),
                )
            }
        }
    }
}

/**
 * 均分模式的付款参与者表：一行一人，序号 + 姓名。
 *
 * 原来是"逗号分隔"的多行文本框；改成逐行表格后每个名字都能单独核对，也不会因为漏逗号
 * 把两个人当成一个人。内部仍以换行拼接的文本保存，与提交要的 `participants: string[]` 一一对应。
 */
@Composable
private fun ParticipantTable(
    rows: List<String>,
    enabled: Boolean,
    onChange: (index: Int, String) -> Unit,
    onAdd: () -> Unit,
    onRemoveLast: () -> Unit,
) {
    val indexWidth = 34.dp
    HairlineCard(Modifier.fillMaxWidth()) {
        Column {
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("付款参与者", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                    Text("不含本人已自付的份额", fontSize = 11.sp, color = Tokens.Muted)
                }
            }
            HorizontalDivider(color = Tokens.Border)
            TableHeadRow(listOf("序" to Modifier.width(indexWidth), "参与者姓名" to Modifier.weight(1f)))
            HorizontalDivider(color = Tokens.Border)
            rows.forEachIndexed { index, name ->
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = MemberRowPadding, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${index + 1}", fontSize = 11.sp, color = Tokens.Muted, modifier = Modifier.width(indexWidth))
                    TableCellInput(
                        label = "参与者姓名",
                        value = name,
                        onValueChange = { onChange(index, it.replace(",", "").replace("，", "")) },
                        placeholder = "与账户户名一致",
                        enabled = enabled,
                        modifier = Modifier.weight(1f),
                    )
                }
                if (index != rows.lastIndex) HorizontalDivider(Modifier.padding(start = MemberRowPadding), color = Tokens.Border.copy(alpha = 0.7f))
            }
            HorizontalDivider(color = Tokens.Border)
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "添加参与者",
                    fontSize = 12.sp,
                    color = if (enabled && rows.size < 30) Tokens.Ink2 else Tokens.Muted,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable(enabled = enabled && rows.size < 30) { onAdd() }
                        .padding(horizontal = 6.dp, vertical = 4.dp),
                )
                Text(
                    "删除末行",
                    fontSize = 12.sp,
                    color = if (enabled && rows.size > 1) Tokens.Ink2 else Tokens.Muted,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable(enabled = enabled && rows.size > 1) { onRemoveLast() }
                        .padding(horizontal = 6.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
fun PaymentPlansScreen(onBack: () -> Unit, initialTab: Int = 0) {
    var tab by rememberSaveable { mutableIntStateOf(initialTab) }
    var formOpen by rememberSaveable { mutableStateOf(false) }
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var banks by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var account by remember { mutableStateOf<AccountDto?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    val submitter = rememberSubmitter()
    var loading by remember { mutableStateOf(true) }
    var name by rememberSaveable { mutableStateOf("") }
    var number by rememberSaveable { mutableStateOf("") }
    var bank by rememberSaveable { mutableStateOf("") }
    var amount by rememberSaveable { mutableStateOf("") }
    var date by rememberSaveable { mutableStateOf("") }
    var memo by rememberSaveable { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var scheduleKey by remember { mutableStateOf("") }
    var reviewSchedule by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<JSONObject?>(null) }
    var aaMode by rememberSaveable { mutableIntStateOf(0) }
    var aaTitle by rememberSaveable { mutableStateOf("") }
    var aaAmount by rememberSaveable { mutableStateOf("") }
    var aaNames by rememberSaveable { mutableStateOf("") }
    var collector by rememberSaveable { mutableStateOf("") }
    val expenses = remember { mutableStateListOf(ExpenseDraft()) }
    // 成员身份：姓名 + 手机号或本行账号（二者填一个即可）。表格草稿与分配结果一一对应。
    var memberDrafts by remember { mutableStateOf(listOf<AaMemberDraft>()) }
    var matching by remember { mutableStateOf<Pair<JSONObject, JSONObject>?>(null) }
    var transactionNo by remember { mutableStateOf("") }
    var aaReview by remember { mutableStateOf<JSONObject?>(null) }
    val aaAllocation = runCatching {
        if (aaMode == 0) allocateSplit(planAmount(aaAmount), splitNames(aaNames))
        else allocateExpenses(collector, expenses.map { SplitExpenseInput(it.title, planAmount(it.amount), splitNames(it.names)) })
    }.getOrNull()
    // 姓名或金额任一变化都会让分摊结果重新计算；按成员姓名沿用已填的手机号/账号/备注，
    // 编辑中途（姓名只有几个字、金额还没输完）也不会把草稿清空。
    val aaParticipants = aaAllocation?.participants.orEmpty()
    LaunchedEffect(aaMode, aaParticipants) {
        memberDrafts = if (aaParticipants.isEmpty()) listOf() else syncMemberDrafts(memberDrafts, aaParticipants)
    }
    fun loadRows(array: org.json.JSONArray): List<JSONObject> = (0 until array.length()).map { array.getJSONObject(it) }
    LaunchedEffect(tab, reload) {
        loading = true
        error = null
        runCatching {
            val path = when (tab) { 0 -> "/api/transfers/scheduled"; 1 -> "/api/transfers/splits"; else -> "/api/transfers/aa-payments" }
            val result = loadRows(BankApi.paymentPlanList(path))
            if (tab == 0) {
                account = BankApi.accounts().singleOrNull()
                banks = loadRows(BankApi.paymentPlanList("/api/banks")).filter { it.optString("region") == "CN" }
                if (bank.isBlank()) bank = banks.firstOrNull { it.optString("code") == "LCB" }?.optString("code") ?: banks.firstOrNull()?.optString("code").orEmpty()
            }
            result
        }.onSuccess { rows = it }.onFailure { rows = emptyList(); error = it.message ?: "加载失败" }
        loading = false
        refreshing = false
    }
    fun runWrite(work: suspend () -> Unit) {
        submitter.submit(
            fallback = "操作失败，请核查结果",
            onStart = { error = null; message = null },
            onError = {
                error = it
                if (FinancialRecovery.pending != null) { reviewSchedule = false; aaReview = null; selected = null; matching = null }
            },
            onSuccess = { reload++ },
            onFinally = { pin = "" },
        ) { work() }
    }
    BackHandler(enabled = formOpen || submitter.busy) { if (!submitter.busy) formOpen = false }
    PushScreen(
        title = if (formOpen) { if (tab == 0) "新建定时转账" else "发起 AA 收款" } else "定时转账与 AA",
        onBack = { if (!submitter.busy) { if (formOpen) { formOpen = false; error = null } else onBack() } },
        refreshing = refreshing,
        onRefresh = if (formOpen) null else { { if (!refreshing && !submitter.busy) { refreshing = true; BankApi.invalidateReads(); reload++ } } },
        actionContent = { if (!formOpen) ActionIcon(Icons.Refresh, "刷新指令", enabled = !submitter.busy, busy = loading) { if (!loading) { BankApi.invalidateReads(); reload++ } } },
    ) {
        PageColumn {
            if (!formOpen) {
                SegTabs(listOf("定时转账", "AA 收款", "AA 付款"), tab) { if (!submitter.busy) { tab = it; rows = emptyList() } }
                if (tab < 2) {
                    EntryRow(
                        icon = if (tab == 0) Icons.Clock else Icons.Person,
                        title = if (tab == 0) "新建定时转账" else "发起 AA 收款",
                        onClick = { if (!submitter.busy) { formOpen = true; error = null } },
                    )
                }
            }
            if (tab == 0 && formOpen) {
                FormCard("收款与执行信息", subtitle = "按北京时间执行；保存后不冻结资金，到期余额不足会失败。") {
                TextFieldRow("收款人姓名", name, { name = it.take(80) })
                SecureNumberField("收款账号", number, { number = it.filter(Char::isDigit).take(19) }, placeholder = "完整收款账号", maxLength = 19)
                if (banks.isNotEmpty()) {
                    BankSelector(banks, "CN", bank, enabled = !submitter.busy) { bank = it }
                }
                SecureNumberField("金额（元）", amount, { amount = it }, allowDecimal = true)
                TextFieldRow("执行时间（北京时间）", date, { date = it.take(16) }, placeholder = "YYYY-MM-DD HH:MM")
                TextFieldRow("转账备注", memo, { memo = it.take(140) })
                }
                PrimaryButton(if (submitter.busy) "处理中…" else "核对定时转账", onClick = {
                    runCatching {
                        require(name.isNotBlank() && number.matches(Regex("[0-9]{12,19}")) && bank.isNotBlank()) { "请填写完整收款信息" }
                        require(account != null) { "未找到资金账户" }
                        planAmount(amount)
                        val whenAt = java.time.Instant.parse(scheduledIso(date))
                        require(whenAt.isAfter(java.time.Instant.now())) { "执行时间必须晚于现在" }
                    }.onSuccess { scheduleKey = UUID.randomUUID().toString(); reviewSchedule = true }.onFailure { error = it.message ?: "请检查时间格式" }
                })
            }
            if (tab == 1 && formOpen) {
                FormCard("收款信息") {
                SegTabs(listOf("均分待收金额", "分项 AA"), aaMode) { if (!submitter.busy) aaMode = it }
                TextFieldRow("收款事由", aaTitle, { aaTitle = it.take(80) })
                if (aaMode == 0) {
                    // 金额是数字，必须走自绘安全键盘；参与者名单改成下方表格逐行填写。
                    SecureNumberField("待收总额（元）", aaAmount, { aaAmount = it }, allowDecimal = true)
                }
                }
                if (aaMode == 0) {
                    val participantRows = splitNames(aaNames).ifEmpty { listOf("") }
                    ParticipantTable(
                        rows = participantRows,
                        enabled = !submitter.busy,
                        onChange = { index, value ->
                            val next = participantRows.toMutableList()
                            next[index] = value
                            aaNames = next.joinToString("\n")
                        },
                        onAdd = { aaNames = (participantRows + "").joinToString("\n") },
                        onRemoveLast = { aaNames = participantRows.dropLast(1).joinToString("\n") },
                    )
                } else {
                    // 本人必须出现在某项参加者里，否则自付份额永远是 0；用下拉从已填参加者里选，
                    // 避免手动敲出一个错别字导致分摊把本人当成收款人漏算。
                    val expenseNames = expenses.flatMap { splitNames(it.names) }.distinct()
                    FormCard("收款信息") {
                        if (expenseNames.isEmpty()) {
                            Text("先在下方消费明细里填写参加者，再在这里选择本人。", fontSize = 11.sp, color = Tokens.Muted)
                        } else {
                            DropdownRow(
                                label = "本人完整姓名",
                                value = collector,
                                options = expenseNames,
                                enabled = !submitter.busy,
                                onChange = { collector = it },
                            )
                        }
                    }
                    ExpenseTable(
                        expenses = expenses,
                        enabled = !submitter.busy,
                        onChange = { index, expense -> expenses[index] = expense },
                        onRemove = { index -> expenses.removeAt(index) },
                        onAdd = { expenses.add(ExpenseDraft()) },
                    )
                }
                aaAllocation?.let { allocation ->
                    AaMemberTable(
                        participants = allocation.participants,
                        members = memberDrafts,
                        title = aaTitle.ifBlank { "未填写收款事由" },
                        total = allocation.amount,
                        selfAmount = allocation.selfAmount.takeIf { aaMode == 1 },
                        enabled = !submitter.busy,
                        onChange = { transform -> memberDrafts = memberDrafts.map(transform) },
                    )
                }
                PrimaryButton("核对 AA 收款", onClick = {
                    runCatching {
                        val allocation = requireNotNull(aaAllocation) { "请检查金额和参与人" }
                        require(aaTitle.isNotBlank()) { "请填写收款事由" }
                        val members = JSONArray()
                        val used = mutableSetOf<String>()
                        allocation.participants.forEachIndexed { index, participant ->
                            val share = participant.second
                            val row = memberDrafts.getOrNull(index)
                            val identity = row?.identity.orEmpty().trim()
                            val memberName = (row?.name ?: participant.first).trim()
                            // 备注留空时沿用收款事由，与表格里的「默认使用收款事由」一致。
                            val note = (row?.memo.orEmpty().trim().ifEmpty { aaTitle.trim() }).trim()
                            require(memberName.isNotEmpty() && memberName.length <= 40) { "请填写成员姓名" }
                            // 11 位按手机号走，12–19 位按本行账号走；两者只能填一个。
                            val isPhone = identity.matches(Regex("1[3-9][0-9]{9}"))
                            val isAccount = identity.matches(Regex("\\d{12,19}"))
                            require(isPhone || isAccount) { "请为每位成员填写手机号或 12–19 位账号" }
                            require(used.add(identity)) { "同一位成员不能重复填写" }
                            require(note.isNotEmpty() && note.length <= 140) { "请填写有效的付款备注" }
                            members.put(
                                JSONObject()
                                    .put("name", memberName)
                                    .put(if (isPhone) "phone" else "accountNo", identity)
                                    .put("amount", share)
                                    .put("memo", note),
                            )
                        }
                        val input = if (aaMode == 0) JSONObject().put("amount", planAmount(aaAmount)).put("participants", JSONArray(splitNames(aaNames)))
                        else JSONObject().put("collectorName", collector.trim()).put("expenses", JSONArray().apply { expenses.forEach { put(JSONObject().put("title", it.title.trim()).put("amount", planAmount(it.amount)).put("participants", JSONArray(splitNames(it.names)))) } })
                        JSONObject().put("title", aaTitle.trim()).put("currency", "CNY").put("allocation", input).put("members", members).put("confirmed", true).put("clientRequestId", UUID.randomUUID().toString())
                    }.onSuccess { aaReview = it }.onFailure { error = it.message ?: "请检查收款信息" }
                })
            }
            error?.let { ErrorNote(it) }
            message?.let { Text(it, color = Tokens.Ink, fontSize = 12.sp) }
            if (!formOpen) {
            Text(if (tab == 0) "定时指令" else if (tab == 1) "收款记录" else "待付款与历史", fontWeight = FontWeight.SemiBold)
            if (loading) SkeletonCardList()
            else if (rows.isEmpty() && error == null) BankEmptyState(if (tab == 0) "还没有定时指令" else if (tab == 1) "还没有收款记录" else "暂无待付款", if (tab == 0) "保存的指令会在这里显示状态。" else "收付款状态以服务端确认为准。", if (tab == 0) Icons.Clock else Icons.Receipt)
            rows.forEach { row ->
                HairlineCard {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(row.optString("title").ifBlank { row.optString("payeeName") }, fontWeight = FontWeight.Medium)
                        Text("${formatCents(row.optLong("amount"), row.optString("currency", "CNY"))} · ${planStatus(row.optString("status"))}", fontSize = 12.sp)
                        if (tab == 0) Text("执行时间：${parseBankTime(row.optString("executeAt"))?.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")) ?: "待核查"}（北京时间） · ${row.optString("payeeBankCode")}", style = Tokens.Text.hint)
                        if (tab == 2) Text("收款人：${row.optString("collectorName")} · 备注：${row.optString("memo")}", fontSize = 11.sp)
                        if (tab == 1) {
                            val participants = row.optJSONArray("participants") ?: JSONArray()
                            participants.objects().forEach { participant ->
                                Text("${participant.optString("splitName").ifBlank { participant.optString("name") }} · ${formatCents(participant.optLong("amount"), row.optString("currency", "CNY"))} · ${planStatus(participant.optString("status"))}", fontSize = 11.sp)
                                if (row.optString("delivery") != "account-inbox" && row.optString("status") == "open" && participant.optString("status") == "unpaid") TextButton(enabled = !submitter.busy, onClick = { matching = row to participant; transactionNo = ""; error = null }) { Text("核对已有回款") }
                                if (row.optString("status") == "open" && participant.optString("status") == "unpaid") TextButton(enabled = !submitter.busy, onClick = {
                                    runWrite {
                                        val body = JSONObject().put("version", row.getInt("version")).put("participantId", participant.getString("id"))
                                        val response = BankApi.paymentPlanWrite("POST", "/api/transfers/splits/${row.getString("id")}/reminders", body)
                                        message = response.optString("text") + "\n" + response.optString("notice").ifBlank { "仅生成提醒文字，未向他人发送。" }
                                    }
                                }) { Text("提醒") }
                            }
                            if (row.optString("status") == "open") TextButton(enabled = !submitter.busy, onClick = { selected = row }) { Text("取消 AA 收款") }
                        }
                        if (tab == 0 && row.optString("status") == "scheduled") TextButton(enabled = !submitter.busy, onClick = { selected = row }) { Text("取消指令") }
                        if (tab == 2 && row.optString("status") == "unpaid") TextButton(enabled = !submitter.busy, onClick = { selected = row }) { Text("查看并付款") }
                    }
                }
            }
            }
        }
    }
    matching?.let { (collection, participant) -> AlertDialog(onDismissRequest = { if (!submitter.busy) matching = null }, title = { Text("核对已有成功回款") }, text = {
        Column { Text("${participant.optString("name")} · ${formatCents(participant.getLong("amount"), collection.getString("currency"))}\n仅认领本人同币种、同金额的成功转入流水，不产生新扣款。"); TextFieldRow("成功转入流水编号", transactionNo, { if (!submitter.busy) transactionNo = it.take(100) }); error?.let { ErrorNote(it) } }
    }, confirmButton = { TextButton(enabled = !submitter.busy, onClick = {
        if (!transactionNo.matches(Regex("[A-Za-z0-9_-]+"))) error = "请填写有效流水编号" else runWrite {
            BankApi.paymentPlanWrite("POST", "/api/transfers/splits/${collection.getString("id")}/payments", JSONObject().put("version", collection.getInt("version")).put("participantId", participant.getString("id")).put("transactionId", transactionNo))
            matching = null; message = "服务端已核对原回款，请查看最新状态。"
        }
    }) { Text("确认核对") } }, dismissButton = { TextButton(enabled = !submitter.busy, onClick = { matching = null }) { Text("取消") } }) }
    aaReview?.let { review -> AlertDialog(onDismissRequest = { if (!submitter.busy) aaReview = null }, title = { Text("确认 AA 收款通知") }, text = {
        val members = review.getJSONArray("members")
        Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(review.getString("title"), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Tokens.Ink, modifier = Modifier.weight(1f))
                Text(
                    "合计 " + formatCents((0 until members.length()).sumOf { members.getJSONObject(it).optLong("amount") }, "CNY"),
                    style = amountStyle.copy(fontSize = 13.sp),
                    maxLines = 1,
                )
            }
            HorizontalDivider(color = Tokens.Border)
            for (index in 0 until members.length()) {
                val member = members.getJSONObject(index)
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${index + 1}. ${member.getString("name")}",
                            fontSize = 13.sp,
                            color = Tokens.Ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Text(formatCents(member.getLong("amount"), "CNY"), style = amountStyle.copy(fontSize = 13.sp), maxLines = 1)
                    }
                    Text(
                        member.optString("phone").ifEmpty { "本行账号 " + member.optString("accountNo") } + " · " + member.getString("memo"),
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                    )
                }
            }
            error?.let { ErrorNote(it) }
        }
    }, confirmButton = { TextButton(enabled = !submitter.busy, onClick = { runWrite {
        BankApi.paymentPlanWrite("POST", "/api/transfers/splits", review)
        aaReview = null; formOpen = false; aaTitle = ""; aaAmount = ""; aaNames = ""; collector = ""; expenses.clear(); expenses.add(ExpenseDraft()); memberDrafts = listOf()
        message = "AA 收款已发起，请核对成员付款状态。"
    } }) { Text("确认发送") } }, dismissButton = { TextButton(enabled = !submitter.busy, onClick = { aaReview = null }) { Text("返回修改") } }) }
    if (reviewSchedule) AlertDialog(onDismissRequest = { if (!submitter.busy) { reviewSchedule = false; pin = "" } }, title = { Text("确认定时转账") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("$name · $number\n银行：$bank\n金额：$amount 元\n执行：$date（北京时间）\n备注：$memo")
            SecurePinField("支付密码", pin, { if (!submitter.busy) pin = it.filter(Char::isDigit).take(6) }, enabled = !submitter.busy)
            error?.let { ErrorNote(it) }
        }
    }, confirmButton = { TextButton(enabled = !submitter.busy && pin.length == 6, onClick = {
        val snapshotPin = pin
        runWrite {
            val instant = scheduledIso(date)
            val body = JSONObject().put("fromAccountId", account!!.id).put("channel", "bank").put("scope", "domestic").put("payeeName", name.trim()).put("payeeAccountNo", number).put("payeeBankCode", bank).put("payeeBankRegion", "CN").put("amount", planAmount(amount)).put("memo", memo).put("executeAt", instant).put("confirmed", true).put("paymentPassword", snapshotPin).put("clientRequestId", scheduleKey)
            BankApi.paymentPlanWrite("POST", "/api/transfers/scheduled", body)
            reviewSchedule = false; formOpen = false; message = "定时转账已保存，请核对指令状态。"
        }
    }) { Text("确认保存") } }, dismissButton = { TextButton(enabled = !submitter.busy, onClick = { reviewSchedule = false; pin = "" }) { Text("返回") } })
    selected?.let { row -> AlertDialog(onDismissRequest = { if (!submitter.busy) { selected = null; pin = "" } }, title = { Text(when (tab) { 0 -> "取消定时转账"; 1 -> "取消 AA 收款"; else -> "确认 AA 付款" }) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(when (tab) { 0 -> "确认取消 ${row.optString("payeeName")} 的定时转账？"; 1 -> "确认取消 ${row.optString("title")} 的 AA 收款？"; else -> "收款人：${row.optString("collectorName")}\n账号：${row.optString("collectorAccountNo")}\n金额：${formatCents(row.optLong("amount"), row.optString("currency", "CNY"))}\n备注：${row.optString("memo")}" })
            if (tab == 2) SecurePinField("支付密码", pin, { if (!submitter.busy) pin = it.filter(Char::isDigit).take(6) }, enabled = !submitter.busy)
            error?.let { ErrorNote(it) }
        }
    }, confirmButton = { TextButton(enabled = !submitter.busy && (tab != 2 || pin.length == 6), onClick = {
        val snapshotPin = pin
        runWrite {
            val id = row.getString("id")
            val body = JSONObject().put("version", row.getInt("version"))
            when (tab) {
                0 -> BankApi.paymentPlanWrite("DELETE", "/api/transfers/scheduled/$id", body)
                1 -> BankApi.paymentPlanWrite("DELETE", "/api/transfers/splits/$id", body)
                else -> BankApi.paymentPlanWrite("POST", "/api/transfers/aa-payments/$id/pay", body.put("confirmed", true).put("paymentPassword", snapshotPin))
            }
            selected = null; message = "请求已处理，请核对最新状态。"
        }
    }) { Text(if (tab != 2) "确认取消" else "确认付款") } }, dismissButton = { TextButton(enabled = !submitter.busy, onClick = { selected = null; pin = "" }) { Text("返回") } }) }
}
