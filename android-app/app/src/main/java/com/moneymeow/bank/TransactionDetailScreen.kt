package com.moneymeow.bank

import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

@Composable
fun TxDetailScreen(onBack: () -> Unit, transactionId: String?) {
    var detail by remember(transactionId) { mutableStateOf<TransactionDetailDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var recalling by remember { mutableStateOf(false) }
    var export by remember { mutableStateOf<TransactionDetailDto?>(null) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val snapshot = export; export = null
        if (uri != null && snapshot != null) scope.launch {
            runCatching { withContext(Dispatchers.IO) {
                val document = PdfDocument()
                try {
                    var pageNumber = 1
                    var page = document.startPage(PdfDocument.PageInfo.Builder(595, 842, pageNumber).create())
                    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 12f }
                    val lines = listOf("招财猫银行 · 交易明细", "由客户端根据银行查询结果导出，非银行签章电子回单。", "导出时间：${bankTime(Instant.now().toString())}（北京时间）") + detailLines(snapshot).map { (key, value) -> "$key：$value" }
                    var y = 48f
                    lines.forEach { line ->
                        var rest = line
                        while (rest.isNotEmpty()) {
                            if (y > 794f) {
                                document.finishPage(page)
                                pageNumber++
                                page = document.startPage(PdfDocument.PageInfo.Builder(595, 842, pageNumber).create())
                                y = 48f
                            }
                            val count = paint.breakText(rest, true, 510f, null).coerceAtLeast(1)
                            page.canvas.drawText(rest.take(count), 42f, y, paint); y += 23f; rest = rest.drop(count)
                        }
                    }
                    document.finishPage(page)
                    context.contentResolver.openOutputStream(uri)?.use { document.writeTo(it) } ?: error("无法打开文件")
                } finally { document.close() }
            } }.onSuccess { message = "交易明细 PDF 已保存" }.onFailure { error = it.message ?: "导出失败" }
        }
    }
    LaunchedEffect(transactionId, reload) {
        error = null; detail = null
        try { detail = BankApi.transaction(transactionId ?: error("未指定交易")) }
        catch (failure: Exception) { error = failure.message ?: "交易详情加载失败" }
        refreshing = false
    }
    PushScreen(
        "交易详情",
        onBack = { if (!busy) onBack() },
        refreshing = refreshing,
        onRefresh = { if (!refreshing) { refreshing = true; BankApi.invalidateReads(); reload++ } },
        actionContent = {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                DetailIconAction(Icons.Refresh, "刷新交易状态") {
                    if (!busy) { BankApi.invalidateReads(); reload++ }
                }
                DetailIconAction(Icons.DownIn, "导出交易明细 PDF") {
                    detail?.let { row -> export = row; save.launch("交易明细-${row.id}.pdf") }
                }
            }
        },
    ) {
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { ErrorNote(it) }
            message?.let { Text(it, color = Tokens.Ink2, fontSize = 12.sp) }
            detail?.let { row ->
                Text(
                    (if (row.direction == "in") "+" else "-") + formatCents(row.amount, row.currency),
                    fontSize = 34.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (row.direction == "out") Tokens.Coral else Tokens.Ink,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 20.dp, bottom = 16.dp),
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    Text(when (row.status) { "success" -> "成功记账"; "pending" -> "处理中"; "failed" -> "未成功"; else -> "状态待核查" }, color = if (row.status == "failed") Tokens.Coral else Tokens.Ink2, fontSize = 13.sp)
                }
                KvCard(detailLines(row))
                if (row.status == "pending" && row.pendingReason == "inflight" && runCatching { Instant.parse(row.holdUntil).isAfter(Instant.now()) }.getOrDefault(false)) PrimaryButton("核对撤销在途转账", onClick = { if (!busy) recalling = true })
            }
        }
    }
    if (recalling) AlertDialog(onDismissRequest = { if (!busy) recalling = false }, title = { Text("撤销在途转账") }, text = { Text("确认撤销这笔尚未执行的在途指令？服务端仅释放本指令预留，不产生退款。是否仍可撤销以服务端校验为准。") }, confirmButton = { TextButton(enabled = !busy, onClick = {
        busy = true; error = null
        scope.launch { try { BankApi.recallTransfer(transactionId!!); message = "已取得撤销回执，请核对最新状态。"; reload++ } catch (failure: Exception) { error = failure.message ?: "请核查撤销结果" } finally { busy = false; recalling = false } }
    }) { Text("确认撤销") } }, dismissButton = { TextButton(enabled = !busy, onClick = { recalling = false }) { Text("返回") } })
}
private fun detailLines(row: TransactionDetailDto): List<Pair<String, String>> = buildList {
    add("交易状态" to when(row.status) { "success" -> "成功记账"; "pending" -> "处理中 · ${row.pendingReason}"; "failed" -> "未成功"; else -> row.status })
    add("交易时间（北京时间）" to bankTime(row.createdAt))
    add("币种" to row.currency); add("金额" to formatCents(row.amount, row.currency)); add("对方" to row.counterparty)
    add("资金账户" to row.accountNo.ifBlank { row.accountLabel.ifBlank { "—" } }.chunked(4).joinToString(" "))
    if (row.otherAccountNo.isNotBlank()) add("对方账户" to maskAccountNo(row.otherAccountNo))
    if (row.otherBank.isNotBlank()) add("对方银行" to row.otherBank)
    add("支付方式" to row.cardLast4.ifBlank { "—" }); add("分类" to BankApi.categoryLabel(row.category))
    add("费用" to formatCents(row.fee, row.currency))
    if (row.originAmount != null && row.originCurrency.isNotBlank()) add("原币金额" to formatCents(row.originAmount, row.originCurrency))
    row.exchangeRate?.let { add("成交汇率" to "1 ${row.originCurrency} = $it ${row.currency}") }
    add("备注" to row.memo.ifBlank { "—" }); add("交易编号" to row.id); add("参考编号" to row.referenceNo.ifBlank { "—" }.chunked(4).joinToString(" "))
}

/** 详情页的小圆形图标操作：刷新 / 导出。 */
@Composable
private fun DetailIconAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    ActionIcon(icon, label, onClick = onClick)
}
