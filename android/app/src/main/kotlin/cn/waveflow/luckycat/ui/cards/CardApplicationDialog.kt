package cn.waveflow.luckycat.ui.cards

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.SecureFlagPolicy
import cn.waveflow.luckycat.contract.bank.*
import cn.waveflow.luckycat.domain.cards.CardRules
import cn.waveflow.luckycat.domain.money.Money
import cn.waveflow.luckycat.ui.theme.Palette

@Composable
internal fun CardApplicationDialog(
    state: CardsUiState,
    old: BankCard?,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
    onSubmit: (String, MailingAddress, String, (Boolean, String?) -> Unit) -> Unit,
) {
    var selected by remember { mutableStateOf("") }
    var address by remember { mutableStateOf(old?.shippingAddress ?: MailingAddress()) }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val product = if (old != null) state.products.find { it.network == old.network }
        else state.products.find { it.code == selected } ?: state.products.firstOrNull()
    val maxHeight = (LocalConfiguration.current.screenHeightDp * .6f).dp
    val busy = state.submitting
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(securePolicy = SecureFlagPolicy.SecureOn),
        title = { Text(if (old == null) "申请新卡" else "换卡") },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = maxHeight).verticalScroll(rememberScrollState()).testTag("card-application-form"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (state.productsLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                state.productsError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (!state.productsLoading && (state.productsError != null || product == null)) {
                    Text("卡产品信息暂不可用")
                    TextButton(onClick = onRetry, modifier = Modifier.testTag("card-products-retry")) { Text("重新加载") }
                }
                if (old == null) state.products.forEach { item ->
                    Row(Modifier.fillMaxWidth().selectable(selected = item.code == product?.code, enabled = !busy, role = Role.RadioButton, onClick = { selected = item.code }).testTag("card-product-${item.code}")) {
                        RadioButton(selected = item.code == product?.code, onClick = null)
                        Column(Modifier.weight(1f).padding(start = 8.dp, top = 10.dp)) {
                            Text(item.name, style = MaterialTheme.typography.titleSmall)
                            Text(item.network.uppercase(), style = MaterialTheme.typography.bodySmall, color = Palette.inkSoft)
                        }
                    }
                }
                product?.let { p ->
                    if (old != null) Text(p.name, style = MaterialTheme.typography.titleSmall)
                    Text("制卡费 ${Money.money(p.issuingFee)} · 寄送费 ${Money.money(p.deliveryFee)}", modifier = Modifier.testTag("card-application-fee"))
                    if (p.deliveryDays > 0) Text("预计 ${p.deliveryDays} 个工作日寄达", color = Palette.inkSoft, style = MaterialTheme.typography.bodySmall)
                    p.perks.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
                if (old != null) Text("换卡后旧卡立即失效，卡号变更；已绑定的自动扣款需重新签约。", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                Text("邮寄地址", style = MaterialTheme.typography.titleSmall)
                AddressField("收件人", address.recipient, "recipient", busy) { address = address.copy(recipient = it) }
                AddressField("手机号", address.phone, "phone", busy, KeyboardType.Phone) { address = address.copy(phone = it) }
                AddressField("省 / 直辖市", address.region, "region", busy) { address = address.copy(region = it) }
                AddressField("城市", address.city, "city", busy) { address = address.copy(city = it) }
                AddressField("详细地址", address.detail, "detail", busy) { address = address.copy(detail = it) }
                AddressField("邮政编码（选填）", address.postalCode, "postal", busy, KeyboardType.Number) { address = address.copy(postalCode = it) }
                OutlinedTextField(password, { password = it.filter { c -> c in '0'..'9' }.take(6); error = null },
                    label = { Text("支付密码") }, singleLine = true, enabled = !busy,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    modifier = Modifier.fillMaxWidth().testTag("card-application-password"))
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("card-application-error")) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                error = CardRules.addressError(address)
                if (error == null && product != null) onSubmit(product.code, address, password) { _, message -> password = ""; error = message }
            }, enabled = product != null && state.productsError == null && !state.productsLoading && !busy && CardRules.validPassword(password), modifier = Modifier.testTag("card-application-submit")) {
                val fee = product?.let { it.issuingFee + it.deliveryFee }
                Text(if (busy) "提交中…" else if (fee != null) "支付 ${Money.money(fee)} 并${if (old == null) "申请" else "换卡"}" else "确认")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.testTag("card-application-cancel")) { Text("取消") } },
    )
}

@Composable
private fun AddressField(label: String, value: String, tag: String, busy: Boolean, keyboard: KeyboardType = KeyboardType.Text, change: (String) -> Unit) {
    OutlinedTextField(value, change, label = { Text(label) }, enabled = !busy, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard), modifier = Modifier.fillMaxWidth().testTag("card-address-$tag"))
}
