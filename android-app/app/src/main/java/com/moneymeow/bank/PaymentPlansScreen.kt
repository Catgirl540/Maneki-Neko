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

/**
 * 身份序列化成接口要的形状：手机号和账号「填了哪个传哪个」。
 *
 * 两个都传的话服务端会用 `手机号|账号` 做主键，与网页端一致；只填手机号时不带空账号，
 * 免得后端把它当成「手机号和账号都给了」。请求体在核对弹窗里再展示一遍，形状错了当场就能看出来。
 */
private fun identityJson(identity: SplitIdentity): JSONObject = JSONObject().put("name", identity.name).apply {
    if (identity.phone.isNotEmpty()) put("phone", identity.phone)
    if (identity.accountNo.isNotEmpty()) put("accountNo", identity.accountNo)
}

private data class ExpenseDraft(val id: String = UUID.randomUUID().toString(), val title: String = "", val amount: String = "", val memberIds: List<String> = emptyList())
internal fun scheduledIso(value: String): String = LocalDateTime.parse(value, DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm").withResolverStyle(java.time.format.ResolverStyle.STRICT)).atZone(ZoneId.of("Asia/Shanghai")).toInstant().toString()
private fun planStatus(status: String) = mapOf("scheduled" to "待执行", "executed" to "已执行", "failed" to "执行失败", "cancelled" to "已取消", "open" to "待收款", "complete" to "已收齐", "unpaid" to "待付款", "processing" to "付款处理中", "paid" to "已付款")[status] ?: "状态待核查"

/**
 * 金额输入只收数字，与网页端同一个口径：整数最多 9 位、小数最多两位，`.5` 规整成 `0.5`。
 *
 * 表单里直接敲进字母会让人以为填好了，所以在输入时就拦下，而不是等提交才报错。
 */
internal fun filterAmount(raw: String): String {
    val cleaned = raw.filter { it.isDigit() || it == '.' }
    val dot = cleaned.indexOf('.')
    val whole = (if (dot < 0) cleaned else cleaned.take(dot)).take(9)
    if (dot < 0) return whole
    return (whole.ifEmpty { "0" }) + "." + cleaned.substring(dot + 1).filter(Char::isDigit).take(2)
}

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

/**
 * 参与者身份行：姓名 + 手机号或本行账号（二者填一个即可）。
 *
 * 与网页端 `PersonRow` 一一对应：只写姓名无法区分同名的人，也无法确定钱发给谁，
 * 所以钱只按手机号/账号发；姓名用来核对户名（服务端 `nameMatches` 会再校验一次）。
 */
private data class AaPersonDraft(
    val id: String = UUID.randomUUID().toString(),
    val name: String = "",
    val identity: String = "",
) {
    /**
     * 行内提示：全新空行不报错（刚点「加号」还没开始填），一旦动手填了就把缺的部分说出来。
     * 提交时的完整校验仍由 [identityOf] 负责，这里只影响观感。
     */
    val error: String?
        get() {
            if (name.isBlank() && identity.isBlank()) return null
            if (name.isBlank()) return "请填写参与者姓名"
            if (classifyIdentity(identity) !in listOf(MemberIdentity.Phone, MemberIdentity.Account)) {
                return if (identity.isBlank()) "请填写手机号或 12–19 位本行账号" else "手机号须 11 位、账号须 12–19 位"
            }
            return null
        }
}

/** 通讯录里的一条收款人（`GET /api/payees`），姓名格的下拉数据源。 */
private data class ContactOption(val id: String, val name: String, val phone: String, val accountNo: String) {
    val identity: String get() = phone.ifEmpty { accountNo }
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

/** 表格外层的卡片：标题 + 右侧说明 + 表体，底部再加一行操作区。 */
@Composable
private fun TableCard(title: String, note: String? = null, footer: (@Composable () -> Unit)? = null, body: @Composable ColumnScope.() -> Unit) {
    // HairlineCard 的内容槽是单个 composable 叠在 Box 里：表体与底部操作区必须放进同一个 Column，
    // 否则两段会互相覆盖（加号按钮会压到表头上）。
    HairlineCard(Modifier.fillMaxWidth()) {
        Column {
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Ink)
                if (note != null) {
                    Spacer(Modifier.weight(1f))
                    Text(note, fontSize = 11.sp, color = Tokens.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            HorizontalDivider(color = Tokens.Border)
            body()
            if (footer != null) {
                HorizontalDivider(color = Tokens.Border)
                Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) { footer() }
            }
        }
    }
}

/**
 * 表格底部的「加号」按钮：安卓端没有网页那样的图标按钮尺寸档位，这里给一个 32dp 的浅底方块，
 * 与页面上的其它小图标按钮同一观感，点开就是再加一行。
 */
@Composable
private fun AddRowButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(32.dp)
            .clip(RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Plus, contentDescription = null, tint = if (enabled) Tokens.Ink2 else Tokens.Muted, modifier = Modifier.size(17.dp))
    }
}

/** 删除一行的文字按钮：用珊瑚色，和网页端 `text-coral` 一致，不做成实心红块。 */
@Composable
private fun RemoveRowButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 11.sp,
        color = if (enabled) Tokens.Coral else Tokens.Muted,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 4.dp),
    )
}

/** 身份格下方的即时提示：说明当前填的内容会被当作哪种身份。 */
private fun identityHint(value: String): String = when (classifyIdentity(value)) {
    MemberIdentity.Phone -> "按手机号收款"
    MemberIdentity.Account -> "按本行账号收款"
    MemberIdentity.Empty -> "二者填一个即可"
    MemberIdentity.Partial -> if (value.length > 11) "账号 ${value.length} 位" else "手机号 ${value.length}/11 位"
    MemberIdentity.Invalid -> "格式无效"
}

/**
 * 参与者身份表：一行一人，姓名 + 手机号或本行账号。
 *
 * 取代原来「只填姓名」的参与人表：只写姓名分不清同名的两个人，也没法确定钱付给谁。
 * 姓名格带通讯录下拉（[contacts]），选中已存的收款人会把手机号/账号带过来；
 * 姓名与本人户名一致的那行打「本人」标——发起人就是收款人，不再单独问「你是哪一位」。
 */
@Composable
private fun AaPersonTable(
    people: List<AaPersonDraft>,
    contacts: List<ContactOption>,
    selfName: String,
    enabled: Boolean,
    onChange: ((AaPersonDraft) -> AaPersonDraft) -> Unit,
    onRemove: (String) -> Unit,
    onAdd: () -> Unit,
    onSaveContact: (AaPersonDraft) -> Unit,
) {
    val selfRow = people.firstOrNull { it.name.trim().isNotEmpty() && NameDisplay.matches(it.name, selfName) }
    TableCard(
        title = "参与者身份",
        note = "${people.size} 人 · 至少 2 人",
        footer = { AddRowButton("添加参与者", enabled && people.size < 30, onAdd) },
    ) {
        TableHeadRow(
            listOf(
                "姓名" to Modifier.weight(1f),
                "手机号或本行账号" to Modifier.weight(1.15f).padding(start = 6.dp),
                " " to Modifier.width(44.dp),
            ),
        )
        HorizontalDivider(color = Tokens.Border)
        people.forEachIndexed { index, person ->
            val isSelf = selfRow?.id == person.id
            val saved = contacts.any { it.name == person.name.trim() }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = MemberRowPadding, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AaNameCell(
                    index = index,
                    value = person.name,
                    contacts = contacts,
                    isSelf = isSelf,
                    canSave = person.name.trim().isNotEmpty() && !isSelf && !saved,
                    enabled = enabled,
                    onValueChange = { raw ->
                        // 选中通讯录里的人就把手机号/账号带过来，只填空着的身份格，不覆盖已经填的内容。
                        val hit = contacts.firstOrNull { it.name == raw }
                        onChange { row -> if (row.id != person.id) row else row.copy(name = raw.take(MEMBER_NAME_MAX), identity = if (hit != null && row.identity.isBlank()) hit.identity else row.identity) }
                    },
                    onSaveContact = { onSaveContact(person) },
                    modifier = Modifier.weight(1f),
                )
                AaIdentityCell(
                    index = index,
                    value = person.identity,
                    enabled = enabled,
                    onChange = { raw -> onChange { row -> if (row.id == person.id) row.copy(identity = raw.filter(Char::isDigit).take(MEMBER_IDENTITY_MAX)) else row } },
                    modifier = Modifier.weight(1.15f),
                )
                Box(Modifier.width(44.dp), contentAlignment = Alignment.CenterEnd) {
                    if (people.size > 1) RemoveRowButton("删除", enabled) { onRemove(person.id) }
                }
            }
            person.error?.let { ErrorNote(it, Modifier.padding(start = MemberRowPadding, bottom = 2.dp)) }
            if (index != people.lastIndex) HorizontalDivider(Modifier.padding(start = MemberRowPadding), color = Tokens.Border.copy(alpha = 0.7f))
        }
    }
}

/** 姓名格：可输入 + 通讯录下拉。「本人」与「存」两个小标只在需要时出现，不占固定宽度。 */
@Composable
private fun AaNameCell(
    index: Int,
    value: String,
    contacts: List<ContactOption>,
    isSelf: Boolean,
    canSave: Boolean,
    enabled: Boolean,
    onValueChange: (String) -> Unit,
    onSaveContact: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val matching = remember(value, contacts) {
        if (value.isBlank()) contacts else contacts.filter { it.name.contains(value.trim()) || it.identity.contains(value.trim()) }
    }
    // 宽度由调用方的 weight(1f) 给：这里不能再 fillMaxWidth，否则会把同一行里的身份格挤成 0 宽。
    Box(modifier) {
        Column(
            Modifier
                .clip(RoundedCornerShape(8.dp))
                .padding(horizontal = 6.dp, vertical = 4.dp)
                .semantics { contentDescription = "第 ${index + 1} 位参与者姓名" },
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BasicTextField(
                    value = value,
                    onValueChange = { onValueChange(it); expanded = true },
                    enabled = enabled,
                    singleLine = true,
                    textStyle = tableValueStyle,
                    cursorBrush = SolidColor(Tokens.Accent),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (value.isEmpty()) Text("与账户户名一致", fontSize = 13.sp, color = Tokens.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        inner()
                    },
                )
                if (contacts.isNotEmpty()) {
                    Icon(
                        Icons.Chevron,
                        contentDescription = "从通讯录选择收款人",
                        tint = Tokens.Muted,
                        modifier = Modifier
                            .size(14.dp)
                            .clickable(enabled = enabled) { expanded = true },
                    )
                }
            }
            Row(Modifier.height(15.dp), verticalAlignment = Alignment.CenterVertically) {
                if (isSelf) {
                    Text(
                        "本人",
                        fontSize = 10.sp,
                        color = Tokens.Ink,
                        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Tokens.SurfaceWarm).padding(horizontal = 4.dp, vertical = 1.dp),
                    )
                } else if (canSave) {
                    Text(
                        "存",
                        fontSize = 10.sp,
                        color = Tokens.Ink2,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable(enabled = enabled, role = Role.Button, onClick = onSaveContact)
                            .semantics { contentDescription = "把${value.trim()}存入通讯录" }
                            .padding(horizontal = 4.dp, vertical = 1.dp),
                    )
                }
            }
        }
        androidx.compose.material3.DropdownMenu(expanded, { expanded = false }, Modifier.heightIn(max = 280.dp)) {
            if (matching.isEmpty()) {
                androidx.compose.material3.DropdownMenuItem(text = { Text("通讯录里没有匹配的收款人", fontSize = 12.sp, color = Tokens.Muted) }, onClick = { expanded = false })
            } else {
                matching.forEach { contact ->
                    androidx.compose.material3.DropdownMenuItem(
                        text = {
                            Column {
                                Text(contact.name, fontSize = 13.sp, color = Tokens.Ink)
                                Text(contact.identity, fontSize = 11.sp, color = Tokens.Muted)
                            }
                        },
                        onClick = { onValueChange(contact.name); expanded = false },
                    )
                }
            }
        }
    }
}

/** 身份格：只收数字。手机号 / 账号都走自绘安全键盘，避免系统输入法的联想与云输入。 */
@Composable
private fun AaIdentityCell(index: Int, value: String, enabled: Boolean, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    val invalid = classifyIdentity(value) == MemberIdentity.Invalid
    Column(
        modifier
            .widthIn(min = 118.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (open) Tokens.SurfaceWarm else Color.Transparent)
            .clickable(enabled = enabled, role = Role.Button) { focus.clearFocus(); open = true }
            .padding(horizontal = 6.dp, vertical = 4.dp)
            .semantics { contentDescription = "第 ${index + 1} 位参与者手机号或本行账号" },
    ) {
        Text(
            value.ifEmpty { "11 位手机号或 12–19 位账号" },
            fontSize = 13.sp,
            color = if (value.isEmpty()) Tokens.Muted else Tokens.Ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = tableValueStyle.copy(fontFeatureSettings = "tnum"),
        )
        Text(identityHint(value), fontSize = 10.sp, color = if (invalid) Tokens.Coral else Tokens.Muted, maxLines = 1, modifier = Modifier.height(15.dp))
    }
    if (open && enabled) {
        SecureNumberPadDialog(
            title = "手机号或本行账号",
            subtitle = "二者填一个即可",
            value = value,
            maxLength = MEMBER_IDENTITY_MAX,
            masked = false,
            allowDecimal = false,
            shuffle = false,
            onValueChange = onChange,
            onDismiss = { open = false },
        )
    }
}

/**
 * 分项 AA 的消费明细表：每行一项消费（事由 / 全额 / 参加者）。
 *
 * 参加者用参与者行的 id 勾选，而不是再敲一遍姓名——既不会因为错别字把同一个人算成两份，
 * 也不会在人数变化后对不上号（网页端 `memberIds` 同一套做法）。
 */
@Composable
private fun ExpenseTable(
    expenses: List<ExpenseDraft>,
    people: List<AaPersonDraft>,
    enabled: Boolean,
    onChange: (index: Int, ExpenseDraft) -> Unit,
    onRemove: (index: Int) -> Unit,
    onAdd: () -> Unit,
) {
    TableCard(
        title = "消费明细",
        note = "每项独立均摊，再汇总每人应付",
        footer = { AddRowButton("添加消费", enabled && expenses.size < 30, onAdd) },
    ) {
        TableHeadRow(
            listOf(
                "消费事由" to Modifier.weight(1f),
                "全额" to Modifier.width(78.dp).padding(start = 6.dp),
                " " to Modifier.width(44.dp),
            ),
        )
        HorizontalDivider(color = Tokens.Border)
        expenses.forEachIndexed { index, expense ->
            Column(Modifier.fillMaxWidth().padding(horizontal = MemberRowPadding, vertical = 2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TableCellInput(
                        label = "第 ${index + 1} 项消费事由",
                        value = expense.title,
                        onValueChange = { onChange(index, expense.copy(title = it.take(80))) },
                        placeholder = "聚餐、打车…",
                        enabled = enabled,
                        modifier = Modifier.weight(1f),
                    )
                    Box(Modifier.width(78.dp).padding(start = 6.dp)) {
                        AaAmountCell(
                            label = "全额",
                            value = expense.amount,
                            onValueChange = { onChange(index, expense.copy(amount = it)) },
                            enabled = enabled,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    Box(Modifier.width(44.dp), contentAlignment = Alignment.CenterEnd) {
                        if (expenses.size > 1) RemoveRowButton("删除", enabled) { onRemove(index) }
                    }
                }
                // 参加者：用参与者行做成小标签，点一下勾选/取消，和网页端的复选框胶囊同一效果。
                Row(
                    Modifier.fillMaxWidth().padding(start = 6.dp, bottom = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    people.forEach { person ->
                        val checked = expense.memberIds.contains(person.id)
                        val usable = enabled && person.name.isNotBlank()
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .border(1.dp, if (checked) Tokens.Accent else Tokens.Border, RoundedCornerShape(6.dp))
                                .background(if (checked) Tokens.SurfaceWarm else Color.Transparent)
                                .clickable(enabled = usable) {
                                    onChange(index, expense.copy(memberIds = if (checked) expense.memberIds - person.id else expense.memberIds + person.id))
                                }
                                .semantics { contentDescription = "第 ${index + 1} 项消费的参加者 ${person.name}" }
                                .padding(horizontal = 7.dp, vertical = 3.dp),
                        ) {
                            Text(
                                person.name.ifBlank { "未命名" },
                                fontSize = 11.5.sp,
                                color = if (checked) Tokens.Ink else Tokens.Ink2,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
            if (index != expenses.lastIndex) HorizontalDivider(Modifier.padding(start = MemberRowPadding), color = Tokens.Border.copy(alpha = 0.7f))
        }
    }
}

/**
 * 参与人清单：直接由分摊结果生成，身份来自同一批输入，不会再出现「算账一个名字、发钱另一个账号」。
 *
 * 只在分摊算得出来时显示（与网页端 `preview` 一致）：填一半的表算不出结果，
 * 与其显示一张空表，不如让上面那张表先把身份填完。备注逐人可改，默认等于收款事由。
 */
@Composable
private fun AaPreviewTable(
    allocation: SplitAllocationResult,
    title: String,
    memos: Map<String, String>,
    enabled: Boolean,
    onMemoChange: (key: String, value: String) -> Unit,
) {
    TableCard(
        title = "参与人清单",
        note = "共 ${allocation.participants.size} 人 · 待收 ${formatCents(allocation.amount)}" +
            if (allocation.selfAmount > 0) " · 本人份额 ${formatCents(allocation.selfAmount)}" else "",
    ) {
        if (allocation.expenses.isNotEmpty()) {
            Text(
                "消费合计 ${formatCents(allocation.expenseTotal)}：" + allocation.expenses.joinToString("；") { item ->
                    item.title + " " + item.shares.joinToString("／") { it.identity.name + " " + formatCents(it.amount) }
                },
                fontSize = 11.sp,
                lineHeight = 16.sp,
                color = Tokens.Muted,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
            )
            HorizontalDivider(color = Tokens.Border)
        }
        TableHeadRow(listOf("姓名" to Modifier.weight(0.8f), "手机号或本行账号" to Modifier.weight(1.2f).padding(start = 6.dp), "应付" to Modifier.width(84.dp), "" to Modifier.width(0.dp)))
        HorizontalDivider(color = Tokens.Border)
        allocation.participants.forEachIndexed { index, share ->
            val key = share.identity.accountNo.ifEmpty { share.identity.phone }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = MemberRowPadding, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(share.identity.name, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Tokens.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(0.8f))
                Text(share.identity.identity, fontSize = 12.sp, color = Tokens.Ink2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1.2f).padding(start = 6.dp))
                Text(formatCents(share.amount), style = amountStyle.copy(fontSize = 13.sp), maxLines = 1, textAlign = TextAlign.End, modifier = Modifier.width(84.dp))
            }
            // 转账备注：默认跟着收款事由走，占位符也是收款事由，清空即恢复默认。
            TableCellInput(
                label = "${share.identity.name}转账备注",
                value = memos[key] ?: title,
                onValueChange = { onMemoChange(key, it.take(MEMBER_MEMO_MAX)) },
                placeholder = title.ifBlank { "转账备注" },
                enabled = enabled,
                modifier = Modifier.padding(start = MemberRowPadding - 6.dp).fillMaxWidth(),
            )
            if (index != allocation.participants.lastIndex) HorizontalDivider(color = Tokens.Border.copy(alpha = 0.7f))
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
    val scope = rememberCoroutineScope()
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
    // 默认均分：大多数 AA 就是「一共多少钱、几个人平摊」，分项只在真有多项活动时才用。
    var aaMode by rememberSaveable { mutableIntStateOf(0) }
    var aaTitle by rememberSaveable { mutableStateOf("") }
    var aaAmount by rememberSaveable { mutableStateOf("") }
    // 参与者一律以「姓名 + 手机号或账号」录入；分项模式下参加者按这张表的行 id 勾选。
    var aaPeople by remember { mutableStateOf(listOf(AaPersonDraft())) }
    val expenses = remember { mutableStateListOf(ExpenseDraft()) }
    // 通讯录：与转账页共用一份收款人，姓名格从这里下拉选，发起成功后后端会把成员记进去。
    var contacts by remember { mutableStateOf<List<ContactOption>>(emptyList()) }
    // 转账备注逐人可改：默认等于收款事由，键用手机号/账号，避免同名串台。
    var memos by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var matching by remember { mutableStateOf<Pair<JSONObject, JSONObject>?>(null) }
    var transactionNo by remember { mutableStateOf("") }
    var aaReview by remember { mutableStateOf<JSONObject?>(null) }
    val selfName = SessionStore.name()
    // 发起人就是收款人：参与者表里姓名与本人户名一致的那行就是本人，不再单独问「你是哪一位」。
    val selfPerson = aaPeople.firstOrNull { it.name.trim().isNotEmpty() && NameDisplay.matches(it.name, selfName) }
    val aaAllocation = runCatching {
        if (aaMode == 0) allocateSplit(planAmount(aaAmount), aaPeople.map { identityOf(it.name, it.identity) })
        else {
            val self = requireNotNull(selfPerson) { "参与者表里要有一位是你本人（${selfName.ifBlank { "当前账户户名" }}）" }
            allocateExpenses(
                identityOf(self.name, self.identity),
                expenses.map { item ->
                    require(item.memberIds.isNotEmpty()) { "每项消费至少要选一位参与者" }
                    SplitExpenseInput(item.title, planAmount(item.amount), item.memberIds.map { id ->
                        identityOf(requireNotNull(aaPeople.firstOrNull { it.id == id }) { "参加者已不存在，请重新选择" }.name, aaPeople.first { it.id == id }.identity)
                    })
                },
            )
        }
    }.getOrNull()
    // 通讯录只在打开 AA 表单时拉一次：它不是收款状态，没必要跟着每次刷新重新请求。
    LaunchedEffect(formOpen, tab) {
        if (formOpen && tab == 1) runCatching { BankApi.savedPayees("") }.onSuccess { rows -> contacts = (0 until rows.length()).map { i -> rows.getJSONObject(i).let { ContactOption(it.optString("id"), it.optString("name"), it.optString("phone"), it.optString("accountNo")) } } }
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
                // 先选分摊方式，再填这一次的收款信息：两种方式共用「收款事由」，均分模式多一个待收总额。
                SegTabs(listOf("待收金额均分", "分项 AA"), aaMode) { if (!submitter.busy) aaMode = it }
                // 收款事由和待收总额是同一件事的两半，放同一张卡；窄屏仍按竖排，宽屏并排。
                FormCard(if (aaMode == 0) "收款信息" else "收款事由") {
                    TextFieldRow("收款事由", aaTitle, { aaTitle = it.take(80) })
                    if (aaMode == 0) {
                        // 金额是数字，必须走自绘安全键盘。
                        SecureNumberField("待收总额（元）", aaAmount, { aaAmount = it }, allowDecimal = true)
                    }
                }
                AaPersonTable(
                    people = aaPeople,
                    contacts = contacts,
                    selfName = selfName,
                    enabled = !submitter.busy,
                    onChange = { transform -> aaPeople = aaPeople.map(transform) },
                    onRemove = { id ->
                        aaPeople = aaPeople.filterNot { it.id == id }
                        // 删除参与者时一并把他从各消费的参加者里摘掉，避免勾选了一个已经不存在的人。
                        expenses.replaceAll { it.copy(memberIds = it.memberIds - id) }
                    },
                    onAdd = { aaPeople = aaPeople + AaPersonDraft() },
                    onSaveContact = { person ->
                        // 存通讯录是一次普通写请求：不弹键盘、不走支付密码，失败就地报错即可。
                        scope.launch {
                            error = null
                            runCatching { BankApi.addPayee(identityOf(person.name, person.identity)) }
                                .onSuccess { saved ->
                                    val added = ContactOption(saved.optString("id"), saved.optString("name"), saved.optString("phone"), saved.optString("accountNo"))
                                    contacts = contacts.filterNot { it.id == added.id } + added
                                    message = "已把 ${person.name.trim()} 存入收款人通讯录。"
                                }
                                .onFailure { error = it.message ?: "保存失败" }
                        }
                    },
                )
                if (aaMode == 1) {
                    ExpenseTable(
                        expenses = expenses,
                        people = aaPeople,
                        enabled = !submitter.busy,
                        onChange = { index, expense -> expenses[index] = expense },
                        onRemove = { index -> expenses.removeAt(index) },
                        onAdd = { expenses.add(ExpenseDraft()) },
                    )
                    if (selfPerson == null) {
                        // 本人不在参与者表里，分项 AA 就没有自付份额，钱会全额分给别人。
                        ErrorNote("参与者表里要有一位是你本人（${selfName.ifBlank { "当前账户户名" }}），否则本人份额不会被扣除。")
                    }
                }
                aaAllocation?.let { allocation ->
                    AaPreviewTable(
                        allocation = allocation,
                        title = aaTitle.trim(),
                        memos = memos,
                        enabled = !submitter.busy,
                        onMemoChange = { key, value -> memos = memos + (key to value) },
                    )
                }
                PrimaryButton("核对 AA 收款", enabled = aaAllocation != null, onClick = {
                    runCatching {
                        val allocation = requireNotNull(aaAllocation) { "请检查金额和参与人" }
                        require(aaTitle.isNotBlank()) { "请填写收款事由" }
                        val members = JSONArray()
                        // 成员表直接由分摊结果生成：身份来自同一批输入，不会再出现「算账一个名字、发钱另一个账号」。
                        allocation.participants.forEach { share ->
                            val person = share.identity
                            // 转账备注默认与收款事由一致，可在「参与人清单」里逐人修改。
                            val note = (memos[person.accountNo.ifEmpty { person.phone }] ?: aaTitle).trim()
                            require(note.isNotEmpty() && note.length <= MEMBER_MEMO_MAX) { "请填写${person.name}的转账备注，最多 $MEMBER_MEMO_MAX 字" }
                            members.put(
                                JSONObject()
                                    .put("name", person.name)
                                    .put(if (person.phone.isNotEmpty()) "phone" else "accountNo", person.identity)
                                    .put("amount", share.amount)
                                    .put("memo", note),
                            )
                        }
                        // 注意：JSONArray().apply { ... } 里的 put 会解析到 JSONObject 的 put，数组会始终为空。
                        // 所以这里显式用数组变量名调用，别图省事用 apply 的作用域接收者。
                        val input = if (aaMode == 0) {
                            val participants = JSONArray()
                            aaPeople.forEach { participants.put(identityJson(identityOf(it.name, it.identity))) }
                            JSONObject().put("amount", planAmount(aaAmount)).put("participants", participants)
                        } else {
                            val self = requireNotNull(selfPerson) { "参与者表里要有一位是你本人（${selfName.ifBlank { "当前账户户名" }}）" }
                            val items = JSONArray()
                            expenses.forEach { item ->
                                val participants = JSONArray()
                                item.memberIds.forEach { id ->
                                    val row = requireNotNull(aaPeople.firstOrNull { it.id == id }) { "参加者已不存在，请重新选择" }
                                    participants.put(identityJson(identityOf(row.name, row.identity)))
                                }
                                items.put(
                                    JSONObject().put("title", item.title.trim()).put("amount", planAmount(item.amount)).put("participants", participants),
                                )
                            }
                            JSONObject().put("collectorName", identityJson(identityOf(self.name, self.identity))).put("expenses", items)
                        }
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
        aaReview = null; formOpen = false; aaTitle = ""; aaAmount = ""; aaPeople = listOf(AaPersonDraft()); memos = emptyMap(); expenses.clear(); expenses.add(ExpenseDraft())
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
